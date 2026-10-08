import "server-only";

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SfxCue } from "~/features/explainer/audio-mixer";
import {
  ENGINE_VERSION,
  MASTER_GAIN,
  SFX_PEAK_DB,
  sfxGain,
} from "~/features/explainer/engine";
import type { VideoArtifact } from "~/features/explainer/types";
import { runProcess } from "~/server/child-process";
import {
  audioPieces,
  editDuration,
  outputTime,
  parseSilences,
  planFeedEdit,
  type TimeEdit,
} from "./feed-edit";
import { readVoiceClip } from "./store";

// The ffmpeg half of the MP4 renderer: cutting a film into segments, mixing
// its soundtrack and joining the rendered segments. It never loads Chromium or
// puppeteer, so the render route that runs it ships ffmpeg alone (render.ts
// has the Chromium half, which runs in the segment route).

export type RenderFormat = "landscape" | "vertical";

export const RENDER_FPS = 30;

/** Frames per segment. Segments render in parallel, each well inside a function's time limit. */
const SEGMENT_FRAMES = RENDER_FPS * 5;

/**
 * How a segment's frames are encoded. Every segment of a film uses the same
 * settings, so they join without re-encoding. The vertical MP4 goes to
 * Shorts, Reels and TikTok, which re-encode whatever they get: it is made at
 * full 1080×1920 with room for thin lines and small text to survive that
 * (quality-targeted, capped at 8 Mbps; flat motion graphics land well below).
 */
export function videoCodecArgs(format: RenderFormat): string[] {
  if (format === "landscape")
    return [
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
    ];
  return [
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-tune",
    "animation",
    "-crf",
    "14",
    "-maxrate",
    "8M",
    "-bufsize",
    "16M",
    "-profile:v",
    "high",
    "-level:v",
    "4.2",
    "-pix_fmt",
    "yuv420p",
  ];
}

/** The frame ranges [from, to) a film (or its feed cut) is cut into for parallel rendering. */
export function segmentRanges(
  artifact: VideoArtifact,
  edit?: TimeEdit,
): Array<{ from: number; to: number }> {
  const frames = edit
    ? Math.ceil(editDuration(edit) * RENDER_FPS - 1e-6)
    : Math.ceil(artifact.timing.DURATION * RENDER_FPS);
  const ranges: Array<{ from: number; to: number }> = [];
  for (let from = 0; from < frames; from += SEGMENT_FRAMES)
    ranges.push({ from, to: Math.min(frames, from + SEGMENT_FRAMES) });
  return ranges;
}

/**
 * `promise`, or a rejection with the signal's reason once it aborts. For work
 * that takes no signal of its own (the store's reads and writes, which have
 * their own request timeouts), so a deadline is never left waiting on it.
 */
export function untilAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason as Error);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

export async function ffmpegPath(): Promise<string> {
  const path = (await import("ffmpeg-static")).default as unknown as
    string | null;
  if (!path) throw new Error("No ffmpeg binary for this platform.");
  return path;
}

function ffmpeg(binary: string, args: string[], signal?: AbortSignal) {
  return runProcess(binary, ["-y", "-loglevel", "error", ...args], {
    signal,
    label: "ffmpeg",
  });
}

/** A known effect sound; the name comes from the stage, so it is checked. */
const isKnownEffect = (name: string) => Object.hasOwn(SFX_PEAK_DB, name);

/**
 * The soundtrack's inputs and filter graph: narration clips and effect hits,
 * placed and balanced the way the live player mixes them, then normalized to
 * -16 LUFS: social feeds play loud, and a quiet file sounds broken next to
 * everything else. The pad before loudnorm keeps it from clipping the tail.
 * Each effect sound is an input (and decoded) once, then split per cue.
 */
export function soundtrackGraph(params: {
  voices: Array<{ path: string; start: number }>;
  /** Effect sound files by name; cues whose sound is missing are skipped. */
  effects: ReadonlyMap<string, string>;
  cues: SfxCue[];
  duration: number;
  /**
   * A feed cut (the vertical MP4): the narration is laid out on the film's
   * clock, then only the stretches the cut keeps are placed on its own
   * clock, and each effect hit moves to where its moment lands in the cut.
   */
  edit?: TimeEdit;
}): { inputs: string[]; graph: string } {
  const inputs: string[] = [];
  const chains: string[] = [];
  const labels: string[] = [];
  const addInput = (path: string) => inputs.push(path) - 1;
  const mixIn = (source: string, chain: string) => {
    const label = `[a${labels.length}]`;
    chains.push(`${source}${chain}${label}`);
    labels.push(label);
  };
  const { edit } = params;
  if (edit) {
    const voices = params.voices.map((voice, k) => {
      const index = addInput(voice.path);
      const ms = Math.round(voice.start * 1000);
      chains.push(
        `[${index}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[v${k}]`,
      );
      return `[v${k}]`;
    });
    const pieces = audioPieces(edit);
    const parts = pieces.map((_, k) => `[p${k}]`);
    chains.push(
      `${voices.join("")}amix=inputs=${voices.length}:normalize=0:duration=longest,volume=${MASTER_GAIN},asplit=${pieces.length}${parts.join("")}`,
    );
    for (const [k, piece] of pieces.entries()) {
      const length = piece.to - piece.from;
      const ms = Math.round(piece.at * 1000);
      // Every cut falls in a silence; the short fades only guard against a click.
      const fades =
        length > 0.05
          ? `,afade=t=in:d=0.005,afade=t=out:st=${(length - 0.005).toFixed(3)}:d=0.005`
          : "";
      mixIn(
        parts[k]!,
        `atrim=start=${piece.from.toFixed(3)}:end=${piece.to.toFixed(3)},asetpts=PTS-STARTPTS${fades},adelay=${ms}|${ms}`,
      );
    }
  } else
    for (const voice of params.voices) {
      const index = addInput(voice.path);
      const ms = Math.round(voice.start * 1000);
      mixIn(
        `[${index}:a]`,
        `aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=${MASTER_GAIN}`,
      );
    }
  const cuesBySound = new Map<string, SfxCue[]>();
  for (const source of params.cues) {
    if (!params.effects.has(source.name)) continue;
    let cue = source;
    if (edit) {
      const t = outputTime(edit, source.t);
      // A hit before the cut starts or after it ends is left out.
      if (t === null) continue;
      cue = { ...source, t };
    }
    const list = cuesBySound.get(cue.name) ?? [];
    list.push(cue);
    cuesBySound.set(cue.name, list);
  }
  for (const [name, cues] of cuesBySound) {
    const index = addInput(params.effects.get(name)!);
    const copies = cues.map((_, copy) => `[e${index}_${copy}]`);
    chains.push(
      `[${index}:a]aresample=44100,asplit=${cues.length}${copies.join("")}`,
    );
    for (const [copy, cue] of cues.entries()) {
      const ms = Math.round(cue.t * 1000);
      // A playback-rate change is a resample, which shifts pitch and length together.
      const rate = Math.round(44100 * (cue.rate ?? 1));
      mixIn(
        copies[copy]!,
        `asetrate=${rate},aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=${(MASTER_GAIN * sfxGain(cue.name, cue.gain)).toFixed(4)}`,
      );
    }
  }
  const duration = (edit ? editDuration(edit) : params.duration).toFixed(3);
  const graph = `${chains.join(";")};${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=longest,apad=whole_dur=${Number(duration) + 2},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,atrim=0:${duration}[mix]`;
  return { inputs, graph };
}

/** A film's narration clips, written into `dir`, with where each starts. */
async function writeVoiceClips(
  dir: string,
  artifact: VideoArtifact,
  signal: AbortSignal | undefined,
): Promise<Array<{ path: string; start: number }>> {
  const clips = await untilAborted(
    Promise.all(
      artifact.voices.map((_, index) =>
        readVoiceClip(
          artifact.meta.owner,
          artifact.meta.repo,
          artifact.createdAt,
          index,
        ),
      ),
    ),
    signal,
  );
  const voices: Array<{ path: string; start: number }> = [];
  for (const [index, clip] of clips.entries()) {
    if (!clip) throw new Error(`Narration clip ${index} is missing.`);
    const path = join(dir, `voice-${index}.mp3`);
    await writeFile(path, clip);
    voices.push({ path, start: artifact.voices[index]!.start });
  }
  return voices;
}

/** Quieter than this for long enough is a pause (the voice is alone in its clips). */
const SILENCE_FILTER = "silencedetect=noise=-40dB:d=0.2";

/**
 * Where the narration is silent, on the film's clock: its clips laid out as
 * the soundtrack places them and measured by ffmpeg. A silence that runs to
 * the end of the narration ends at Infinity.
 */
export async function voiceSilences(
  artifact: VideoArtifact,
  signal?: AbortSignal,
): Promise<Array<[number, number]>> {
  const dir = await mkdtemp(join(tmpdir(), "explainer-"));
  try {
    const voices = await writeVoiceClips(dir, artifact, signal);
    const placed = voices.map((voice, k) => {
      const ms = Math.round(voice.start * 1000);
      return `[${k}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${ms}|${ms}[v${k}]`;
    });
    const graph = `${placed.join(";")};${voices.map((_, k) => `[v${k}]`).join("")}amix=inputs=${voices.length}:normalize=0:duration=longest,${SILENCE_FILTER},ametadata=mode=print:file=-[out]`;
    const printed = await runProcess(
      await ffmpegPath(),
      [
        "-loglevel",
        "error",
        ...voices.flatMap((voice) => ["-i", voice.path]),
        "-filter_complex",
        graph,
        "-map",
        "[out]",
        "-f",
        "null",
        "-",
      ],
      { signal, stdout: true, label: "ffmpeg" },
    );
    return parseSilences(printed.toString("utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The feed cut the vertical MP4 is made from (see feed-edit.ts). */
export async function planVerticalEdit(
  artifact: VideoArtifact,
  signal?: AbortSignal,
): Promise<TimeEdit> {
  return planFeedEdit({
    timing: artifact.timing,
    silences: await voiceSilences(artifact, signal),
  });
}

async function mixSoundtrackInto(
  dir: string,
  artifact: VideoArtifact,
  sfx: SfxCue[],
  origin: string,
  signal: AbortSignal | undefined,
  edit: TimeEdit | undefined,
): Promise<string> {
  const voices = await writeVoiceClips(dir, artifact, signal);
  const effects = new Map<string, string>();
  for (const name of new Set(sfx.map((cue) => cue.name))) {
    if (!isKnownEffect(name)) continue;
    const response = await fetch(
      `${origin}/video-engine/assets/sfx/${name}.mp3?v=${ENGINE_VERSION}`,
      { signal },
    );
    if (!response.ok) continue;
    const path = join(dir, `sfx-${name}.mp3`);
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
    effects.set(name, path);
  }
  const { inputs, graph } = soundtrackGraph({
    voices,
    effects,
    cues: sfx,
    duration: artifact.timing.DURATION,
    ...(edit ? { edit } : {}),
  });
  const out = join(dir, "soundtrack.m4a");
  await ffmpeg(
    await ffmpegPath(),
    [
      ...inputs.flatMap((path) => ["-i", path]),
      "-filter_complex",
      graph,
      "-map",
      "[mix]",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      out,
    ],
    signal,
  );
  return out;
}

/**
 * The finished soundtrack as AAC. It needs only the effect cues, which the
 * first segment reports as soon as its stage is built, so it is mixed while
 * the frames are still rendering. Aborting `signal` stops the fetches and
 * kills ffmpeg.
 */
export async function mixSoundtrack(params: {
  artifact: VideoArtifact;
  sfx: SfxCue[];
  origin: string;
  signal?: AbortSignal;
  /** The vertical MP4's feed cut, whose clock the soundtrack then follows. */
  edit?: TimeEdit;
}): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "explainer-"));
  try {
    const out = await mixSoundtrackInto(
      dir,
      params.artifact,
      params.sfx,
      params.origin,
      params.signal,
      params.edit,
    );
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Join rendered segments (in order) with the mixed soundtrack into the final
 * MP4. Aborting `signal` kills ffmpeg.
 */
export async function assembleMp4(params: {
  segments: Buffer[];
  soundtrack: Buffer;
  signal?: AbortSignal;
}): Promise<Buffer> {
  params.signal?.throwIfAborted();
  const dir = await mkdtemp(join(tmpdir(), "explainer-"));
  try {
    const binary = await ffmpegPath();
    const soundtrack = join(dir, "soundtrack.m4a");
    await writeFile(soundtrack, params.soundtrack);
    const list = await Promise.all(
      params.segments.map(async (segment, index) => {
        const path = join(dir, `segment-${index}.mp4`);
        await writeFile(path, segment);
        return `file '${path}'`;
      }),
    );
    const listPath = join(dir, "segments.txt");
    await writeFile(listPath, list.join("\n"));
    const out = join(dir, "film.mp4");
    // No -shortest: with stream copy it cuts at a packet boundary and dropped
    // the last few frames. The soundtrack is already trimmed to the film.
    await ffmpeg(
      binary,
      [
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-i",
        soundtrack,
        "-map",
        "0:v",
        "-map",
        "1:a",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        out,
      ],
      params.signal,
    );
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
