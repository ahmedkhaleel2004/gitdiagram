import type { VideoArtifact } from "./types";

// The browser is the mixing desk: narration clips on the beat clock and the
// scene engine's sound effects. No music bed; the voice carries the film.

const ENGINE = "/video-engine";
// Measured peak of each effect (dBFS); hits are normalized to a -6 dB peak and
// then set to the gain the scene engine asked for. Only soft, untuned foley:
// pitched chimes (check, reject, blip, resolve) read as dings over narration,
// so cues naming them are skipped.
const SFX_PEAK_DB: Record<string, number> = {
  paper: -1.3,
  pop: -5.3,
  stamp: -10.4,
  tick: -5.9,
  typing: -4.3,
  whoosh: -0.7,
};

export interface SfxCue {
  name: string;
  t: number;
  gain: number;
}

function dbToGain(db: number) {
  return 10 ** (db / 20);
}

export function voiceClipUrl(artifact: VideoArtifact, index: number): string {
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
    this.master.gain.value = 0.9;
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
    return this.offset + (this.context.currentTime - this.startedAt);
  }

  async play(from: number): Promise<void> {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    this.stopSources();
    await context.resume();
    const now = context.currentTime + 0.05;
    const at = (time: number) => now + Math.max(0, time - from);

    this.artifact.voices.forEach((voice, index) => {
      const buffer = this.voices[index];
      if (!buffer || voice.start + buffer.duration <= from) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(master);
      source.start(at(voice.start), Math.max(0, from - voice.start));
      this.sources.push(source);
    });

    for (const cue of this.cues) {
      const buffer = this.effects.get(cue.name);
      if (!buffer || cue.t < from - 0.02) continue;
      const source = context.createBufferSource();
      source.buffer = buffer;
      const gain = context.createGain();
      gain.gain.value = dbToGain(-6 - (SFX_PEAK_DB[cue.name] ?? -6) + cue.gain);
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
