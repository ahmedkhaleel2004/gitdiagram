import type { VideoArtifact } from "./types";

// The browser is the mixing desk: narration clips on the beat clock, a music bed
// that dips under the voice, and every SFX hit the scene engine declared.

const ENGINE = "/video-engine";
// Measured peak of each effect (dBFS); hits are normalized to a -6 dB peak and
// then set to the gain the scene engine asked for.
const SFX_PEAK_DB: Record<string, number> = {
  blip: -18,
  check: -11.6,
  paper: -1.3,
  pop: -5.3,
  reject: -7.6,
  resolve: -3.5,
  stamp: -10.4,
  swell: -0.2,
  tick: -5.9,
  typing: -4.3,
  whoosh: -0.7,
};
const BED_GAIN = dbToGain(-19);
const BED_DUCKED = dbToGain(-25);

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
  private bed: AudioBuffer | null = null;
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
    const [voices, bed, effects] = await Promise.all([
      Promise.all(
        this.artifact.voices.map((_, index) =>
          decode(voiceClipUrl(this.artifact, index)),
        ),
      ),
      decode(`${ENGINE}/assets/music/bed-a.mp3`),
      Promise.all(
        names.map(
          async (name) =>
            [name, await decode(`${ENGINE}/assets/sfx/${name}.mp3`)] as const,
        ),
      ),
    ]);
    this.voices = voices;
    this.bed = bed;
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
    const duration = this.artifact.timing.DURATION;
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

    if (this.bed) {
      const bed = context.createBufferSource();
      bed.buffer = this.bed;
      bed.loop = true;
      const gain = context.createGain();
      bed.connect(gain).connect(master);
      this.automateBed(gain.gain, now, from, duration);
      bed.start(now, from % this.bed.duration);
      bed.stop(at(duration));
      this.sources.push(bed);
    }

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

  // Fade in, dip under every spoken beat, fade out at the end.
  private automateBed(
    gain: AudioParam,
    now: number,
    from: number,
    duration: number,
  ) {
    const level = (time: number) =>
      this.artifact.timing.beats.some(
        (beat) => time >= beat.start - 0.2 && time <= beat.end + 0.15,
      )
        ? BED_DUCKED
        : BED_GAIN;
    const fadeIn = Math.min(1, from / 1.2);
    gain.setValueAtTime(level(from) * fadeIn, now);
    if (from < 1.2)
      gain.linearRampToValueAtTime(level(1.2), now + (1.2 - from));
    for (const beat of this.artifact.timing.beats) {
      if (beat.end + 0.6 <= from) continue;
      const down = beat.start - 0.25 - from;
      const up = beat.end + 0.15 - from;
      if (down > 0) {
        gain.setValueAtTime(level(beat.start - 0.3), now + down);
        gain.linearRampToValueAtTime(BED_DUCKED, now + down + 0.25);
      }
      if (up > 0) {
        gain.setValueAtTime(BED_DUCKED, now + up);
        gain.linearRampToValueAtTime(level(beat.end + 0.6), now + up + 0.45);
      }
    }
    const fadeOut = duration - 3 - from;
    if (fadeOut > 0) {
      gain.setValueAtTime(BED_GAIN, now + fadeOut);
      gain.linearRampToValueAtTime(0, now + fadeOut + 3);
    }
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
