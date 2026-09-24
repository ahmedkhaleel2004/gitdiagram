import { MASTER_GAIN, SFX_PEAK_DB, sfxGain } from "./engine";
import { stretchChannels } from "./time-stretch";
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

function voiceClipUrl(artifact: VideoArtifact, index: number): string {
  const params = new URLSearchParams({
    username: artifact.meta.owner,
    repo: artifact.meta.repo,
    beat: String(index),
    v: artifact.createdAt,
  });
  return `/api/video/audio?${params.toString()}`;
}

export class ExplainerAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices: AudioBuffer[] = [];
  private effects = new Map<string, AudioBuffer>();
  private sources: AudioScheduledSourceNode[] = [];
  private startedAt = 0;
  private offset = 0;
  private playing = false;
  /** Video seconds per real second. */
  private rate = 1;
  /** The latest speed asked for; an older request still preparing yields. */
  private wantedRate = 1;
  /** Bumped by every play and pause, so a play that waited never overrides. */
  private ticket = 0;
  /** Narration re-timed for each speed, so voices keep their pitch. */
  private stretched = new Map<number, Promise<AudioBuffer[]>>();

  constructor(
    private readonly artifact: VideoArtifact,
    private readonly cues: SfxCue[],
  ) {}

  /** Fetch and decode everything up front so playback never stalls mid-video. */
  async load(): Promise<void> {
    const context = new AudioContext();
    this.context = context;
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

  currentTime(): number {
    if (!this.context || !this.playing) return this.offset;
    return (
      this.offset + (this.context.currentTime - this.startedAt) * this.rate
    );
  }

  /**
   * Narration for a speed, stretched one clip at a time with a pause between
   * so a phone's page never freezes; later calls share the same work.
   */
  prepare(rate: number): Promise<AudioBuffer[]> {
    const context = this.context;
    if (!context || rate === 1) return Promise.resolve(this.voices);
    let pending = this.stretched.get(rate);
    if (!pending) {
      pending = (async () => {
        const voices: AudioBuffer[] = [];
        for (const voice of this.voices) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          const channels = Array.from(
            { length: voice.numberOfChannels },
            (_, index) => voice.getChannelData(index),
          );
          const output = stretchChannels(channels, voice.sampleRate, rate);
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

  /** Change speed; playback carries on from the same moment. */
  async setRate(rate: number): Promise<void> {
    this.wantedRate = rate;
    await this.prepare(rate);
    if (this.wantedRate !== rate || rate === this.rate) return;
    // Re-anchor the clock first, so it runs on from here at the new speed.
    const time = this.currentTime();
    this.offset = time;
    this.startedAt = this.context?.currentTime ?? 0;
    this.rate = rate;
    if (this.playing) await this.play(time);
  }

  async play(from: number): Promise<void> {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    const ticket = ++this.ticket;
    // Safari mutes Web Audio under the iPhone's silent switch unless the page
    // declares it plays media.
    const session = (
      navigator as Navigator & { audioSession?: { type: string } }
    ).audioSession;
    if (session) session.type = "playback";
    // Resume inside the tap that asked for sound, before anything waits.
    const resumed = context.resume();
    const rate = this.rate;
    const voices = await this.prepare(rate);
    await resumed;
    if (ticket !== this.ticket) return;
    this.stopSources();
    const now = context.currentTime + 0.05;
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
    this.playing = true;
  }

  /** Move the paused clock without making a sound. */
  seek(time: number) {
    if (this.playing) void this.play(time);
    else this.offset = time;
  }

  pause(): number {
    this.ticket++;
    this.offset = this.currentTime();
    this.playing = false;
    this.stopSources();
    return this.offset;
  }

  dispose() {
    this.stopSources();
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
