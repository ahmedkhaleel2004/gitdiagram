import { MASTER_GAIN, SFX_PEAK_DB, sfxGain } from "./engine";
import { stretchChannels } from "./time-stretch";
import type { StretchResponse } from "./time-stretch.worker";
import type { VideoArtifact } from "./types";

// The browser is the mixing desk: narration clips on the beat clock and the
// scene engine's sound effects. No music bed; the voice carries the film.

const ENGINE = "/video-engine";
export interface SfxCue {
  name: string;
  t: number;
  gain: number;
  /** Playback rate; the engine varies it so repeats never sound identical. */
  rate?: number;
}

/** Sound is scheduled this far ahead of the call that starts it. */
const START_DELAY = 0.05;

function voiceClipUrl(artifact: VideoArtifact, index: number): string {
  const params = new URLSearchParams({
    username: artifact.meta.owner,
    repo: artifact.meta.repo,
    beat: String(index),
    v: artifact.createdAt,
  });
  return `/api/video/audio?${params.toString()}`;
}

/** Work cut short because the player closed. */
const closed = () => new DOMException("The player closed.", "AbortError");

const isClosed = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

/**
 * Runs time-stretching in a worker, so a speed change never freezes the page.
 * Without workers (tests, very old browsers) it runs here, after a yield.
 * Once disposed, every stretch, waiting or new, rejects with an AbortError.
 */
class Stretcher {
  private worker: Worker | null = null;
  private failed = typeof Worker === "undefined";
  private disposed = false;
  private next = 0;
  private waiting = new Map<
    number,
    {
      resolve: (channels: Float32Array<ArrayBuffer>[] | null) => void;
      reject: (error: DOMException) => void;
    }
  >();

  get offThread() {
    return !this.failed;
  }

  async stretch(
    channels: Float32Array[],
    sampleRate: number,
    rate: number,
  ): Promise<Float32Array<ArrayBuffer>[]> {
    if (this.disposed) throw closed();
    const worker = this.start();
    if (worker) {
      const id = ++this.next;
      // Copies: the originals belong to the decoded AudioBuffer.
      const copies = channels.map((channel) => channel.slice());
      // Null: the worker failed, so the work is done here instead.
      const result = await new Promise<Float32Array<ArrayBuffer>[] | null>(
        (resolve, reject) => {
          this.waiting.set(id, { resolve, reject });
          worker.postMessage(
            { id, channels: copies, sampleRate, rate },
            copies.map((channel) => channel.buffer),
          );
        },
      );
      if (result) return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (this.disposed) throw closed();
    return stretchChannels(channels, sampleRate, rate);
  }

  dispose() {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.failed = true;
    for (const { reject } of this.waiting.values()) reject(closed());
    this.waiting.clear();
  }

  private start(): Worker | null {
    if (this.worker || this.failed) return this.worker;
    try {
      const worker = new Worker(
        new URL("./time-stretch.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (event: MessageEvent<StretchResponse>) => {
        this.waiting.get(event.data.id)?.resolve(event.data.channels);
        this.waiting.delete(event.data.id);
      };
      // A worker that cannot load (blocked, unsupported) falls back to here.
      worker.onerror = () => {
        worker.terminate();
        this.worker = null;
        this.failed = true;
        for (const { resolve } of this.waiting.values()) resolve(null);
        this.waiting.clear();
      };
      this.worker = worker;
    } catch {
      this.failed = true;
    }
    return this.worker;
  }
}

export class ExplainerAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices: AudioBuffer[] = [];
  private effects = new Map<string, AudioBuffer>();
  private sources: AudioScheduledSourceNode[] = [];
  private startedAt = 0;
  private offset = 0;
  /** Where a play still waiting will start; a seek meanwhile moves it. */
  private startFrom = 0;
  /** The latest time reported while playing; the clock never goes back. */
  private heard = 0;
  private playing = false;
  /** Video seconds per real second. */
  private rate = 1;
  /** The latest speed asked for; an older request still preparing yields. */
  private wantedRate = 1;
  /** Bumped by every play and pause, so a play that waited never overrides. */
  private ticket = 0;
  /**
   * Narration re-timed for a speed, so voices keep their pitch. Only the
   * current speed and the press-and-hold speed are kept (a minute of mono
   * narration is about 10 MB of samples per speed).
   */
  private stretched = new Map<number, Promise<AudioBuffer[]>>();
  private stretcher = new Stretcher();
  /** Called when the system stops the sound (a call, another app), which pauses playback. */
  onInterrupted: (() => void) | null = null;

  constructor(
    private readonly artifact: VideoArtifact,
    private readonly cues: SfxCue[],
    private readonly holdRate = 2,
  ) {}

  /** Fetch and decode everything up front so playback never stalls mid-video. */
  async load(): Promise<void> {
    const context = new AudioContext();
    this.context = context;
    // iOS suspends the context for a call or an app switch; the picture
    // follows the audio clock, so pause rather than show a frozen "playing".
    context.onstatechange = () => {
      if (!this.playing || context.state === "running") return;
      this.pause();
      this.onInterrupted?.();
    };
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.ratio.value = 4;
    this.master = context.createGain();
    this.master.gain.value = MASTER_GAIN;
    this.master.connect(compressor).connect(context.destination);

    const decode = async (url: string) => {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`Audio ${url} failed (${response.status})`);
      return context.decodeAudioData(await response.arrayBuffer());
    };
    const names = [...new Set(this.cues.map((cue) => cue.name))].filter(
      (name) => name in SFX_PEAK_DB,
    );
    const [voices, effects] = await Promise.all([
      Promise.all(
        this.artifact.voices.map((_, index) =>
          decode(voiceClipUrl(this.artifact, index)),
        ),
      ),
      Promise.all(
        names.map(
          async (name) =>
            [name, await decode(`${ENGINE}/assets/sfx/${name}.mp3`)] as const,
        ),
      ),
    ]);
    this.voices = voices;
    this.effects = new Map(effects);
  }

  get isPlaying() {
    return this.playing;
  }

  /**
   * Where the listener is in the video: sound leaves the speakers the
   * context's base and output latency after its clock (a lot on Bluetooth),
   * so the picture waits for it. Never before the point playback started
   * from, and never back: the output latency is re-estimated while playing.
   */
  currentTime(): number {
    const context = this.context;
    if (!context || !this.playing) return this.offset;
    let latency = 0;
    for (const value of [context.outputLatency, context.baseLatency])
      if (Number.isFinite(value) && value > 0) latency += value;
    const heard = context.currentTime - this.startedAt - latency;
    this.heard = Math.max(
      this.heard,
      this.offset + Math.max(0, heard) * this.rate,
    );
    return this.heard;
  }

  /**
   * Narration for a speed; later calls share the same work. Rejects with an
   * AbortError once the player is disposed.
   */
  prepare(rate: number): Promise<AudioBuffer[]> {
    const context = this.context;
    if (!context || rate === 1) return Promise.resolve(this.voices);
    let pending = this.stretched.get(rate);
    if (!pending) {
      pending = (async () => {
        const voices: AudioBuffer[] = [];
        for (const voice of this.voices) {
          const channels = Array.from(
            { length: voice.numberOfChannels },
            (_, index) => voice.getChannelData(index),
          );
          const output = await this.stretcher.stretch(
            channels,
            voice.sampleRate,
            rate,
          );
          if (this.context !== context) throw closed();
          const buffer = context.createBuffer(
            output.length,
            output[0]!.length,
            voice.sampleRate,
          );
          output.forEach((data, index) => buffer.copyToChannel(data, index));
          voices.push(buffer);
        }
        return voices;
      })();
      this.stretched.set(rate, pending);
    }
    return pending;
  }

  /**
   * Stretch a speed ahead of time, only where it costs the page nothing
   * (in a worker); otherwise it waits until that speed is asked for.
   */
  prewarm(rate: number) {
    if (this.stretcher.offThread)
      this.prepare(rate).catch(() => {
        // Closed, or it fails again when the speed is asked for.
      });
  }

  /** Change speed; playback carries on from the same moment. */
  async setRate(rate: number): Promise<void> {
    this.wantedRate = rate;
    for (const kept of this.stretched.keys())
      if (kept !== rate && kept !== this.holdRate) this.stretched.delete(kept);
    try {
      await this.prepare(rate);
    } catch (error) {
      if (isClosed(error)) return;
      throw error;
    }
    if (this.wantedRate !== rate || rate === this.rate) return;
    // Re-anchor the clock first, so it runs on from here at the new speed.
    const time = this.currentTime();
    this.offset = time;
    this.heard = time;
    this.startedAt = this.context?.currentTime ?? 0;
    this.rate = rate;
    if (this.playing) await this.play(time);
  }

  /**
   * Start playing at `from` (or where a seek moved it while this waited).
   * True once sound is scheduled; false when a later play, pause, seek or
   * dispose took over first, so the caller must not show it playing.
   */
  async play(from: number): Promise<boolean> {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return false;
    const ticket = ++this.ticket;
    this.startFrom = from;
    // Safari mutes Web Audio under the iPhone's silent switch unless the page
    // declares it plays media.
    const session = (
      navigator as Navigator & { audioSession?: { type: string } }
    ).audioSession;
    if (session) session.type = "playback";
    // Resume inside the tap that asked for sound, before anything waits.
    const resumed = context.resume();
    resumed.catch(() => {
      // Reported below, when it is awaited.
    });
    // The speed may change while this waits; always start at the latest one.
    let rate = this.rate;
    let voices: AudioBuffer[];
    try {
      voices = await this.prepare(rate);
      await resumed;
      while (ticket === this.ticket && rate !== this.rate) {
        rate = this.rate;
        voices = await this.prepare(rate);
      }
    } catch (error) {
      if (ticket !== this.ticket || isClosed(error)) return false;
      throw error;
    }
    if (ticket !== this.ticket) return false;
    from = this.startFrom;
    this.stopSources();
    const now = context.currentTime + START_DELAY;
    // Video time to the context's clock, and a clip's offset into its stretch.
    const at = (time: number) => now + Math.max(0, time - from) / rate;

    this.artifact.voices.forEach((voice, index) => {
      const buffer = voices[index];
      if (!buffer || voice.start + buffer.duration * rate <= from) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(master);
      source.start(at(voice.start), Math.max(0, from - voice.start) / rate);
      this.sources.push(source);
    });

    for (const cue of this.cues) {
      const buffer = this.effects.get(cue.name);
      if (!buffer || cue.t < from - 0.02) continue;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = cue.rate ?? 1;
      const gain = context.createGain();
      gain.gain.value = sfxGain(cue.name, cue.gain);
      source.connect(gain).connect(master);
      source.start(at(cue.t));
      this.sources.push(source);
    }

    this.startedAt = now;
    this.offset = from;
    this.heard = from;
    this.playing = true;
    return true;
  }

  /**
   * Move the clock. Playing, it plays on from there; a play still waiting
   * starts there; paused, it moves without a sound.
   */
  seek(time: number) {
    if (this.playing)
      this.play(time).catch(() => {
        // The sound could not resume; the next play reports it.
      });
    else {
      this.offset = time;
      this.startFrom = time;
    }
  }

  pause(): number {
    this.ticket++;
    this.offset = this.currentTime();
    this.playing = false;
    this.stopSources();
    // Let the device's audio go while paused (iOS otherwise holds the audio
    // session, keeping other apps quiet and using battery). The next play
    // resumes it inside the tap.
    this.context?.suspend().catch(() => {
      // Closed already.
    });
    return this.offset;
  }

  dispose() {
    this.ticket++;
    this.playing = false;
    this.stopSources();
    this.stretcher.dispose();
    this.stretched.clear();
    if (this.context) this.context.onstatechange = null;
    void this.context?.close();
    this.context = null;
  }

  private stopSources() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.sources = [];
  }
}
