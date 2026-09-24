import "server-only";

import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Page } from "puppeteer-core";
import type { SfxCue } from "~/features/explainer/audio-mixer";
import {
  MASTER_GAIN,
  SFX_PEAK_DB,
  STAGE_PATH,
  sfxGain,
} from "~/features/explainer/engine";
import type { VideoArtifact } from "~/features/explainer/types";
import { readVoiceClip } from "./store";

export type RenderFormat = "landscape" | "vertical";

const RENDER_FPS = 30;

// The stage lays out in CSS pixels at its native size; the device scale factor
// turns that into the output resolution.
const FRAMES: Record<
  RenderFormat,
  { cssWidth: number; cssHeight: number; width: number; height: number }
> = {
  landscape: { cssWidth: 1920, cssHeight: 1080, width: 1280, height: 720 },
  vertical: { cssWidth: 1080, cssHeight: 1920, width: 720, height: 1280 },
};

type StageWindow = Window & { __renderSeek: (time: number) => void };

// @sparticuz/chromium unpacks Chromium and its fonts into /tmp, and treats a
// path as ready as soon as it exists. Two renders starting together on a cold
// instance would launch from half-written files, and the damage outlives the
// request, so every render on an instance shares one unpacking.
let unpacking: Promise<string> | null = null;

async function launchBrowser(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default;
  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default;
    // The default graphics mode emulates a GPU on the CPU (SwiftShader), which
    // is far slower for a 2D page than Chrome's own software renderer.
    chromium.setGraphicsMode = false;
    unpacking ??= chromium.executablePath().catch((error: unknown) => {
      unpacking = null;
      throw error;
    });
    return puppeteer.launch({
      args: [...chromium.args, "--disable-gpu"],
      executablePath: await unpacking,
      headless: "shell",
    });
  }
  const executablePath = process.env.VIDEO_RENDER_CHROME_PATH?.trim();
  if (!executablePath)
    throw new Error(
      "Set VIDEO_RENDER_CHROME_PATH to a headless Chromium to render locally.",
    );
  return puppeteer.launch({ executablePath, headless: "shell" });
}

async function ffmpegPath(): Promise<string> {
  const path = (await import("ffmpeg-static")).default as unknown as
    string | null;
  if (!path) throw new Error("No ffmpeg binary for this platform.");
  return path;
}

async function run(binary: string, args: string[]) {
  const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-2000);
  });
  const [code] = (await once(child, "close")) as [number];
  if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${stderr}`);
}

/** Open the stage with a plan, as the player does, and wait for it to build. */
async function openStage(
  browser: Browser,
  origin: string,
  artifact: VideoArtifact,
  options: { format: RenderFormat; captions: boolean; poster?: boolean },
  scale: number,
): Promise<{ page: Page; sfx: SfxCue[] }> {
  const frame = FRAMES[options.format];
  const page = await browser.newPage();
  await page.setViewport({
    width: frame.cssWidth,
    height: frame.cssHeight,
    deviceScaleFactor: scale,
  });
  await page.goto(`${origin}${STAGE_PATH}`, {
    waitUntil: "load",
    timeout: 30_000,
  });
  const sfx = await page.evaluate(
    (payload) =>
      new Promise<SfxCue[]>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("The stage did not build in time.")),
          25_000,
        );
        window.addEventListener("message", (event: MessageEvent) => {
          const data = event.data as {
            type?: string;
            sfx?: SfxCue[];
            message?: string;
          };
          if (data?.type === "ready") {
            clearTimeout(timer);
            resolve(data.sfx ?? []);
          } else if (data?.type === "error") {
            clearTimeout(timer);
            reject(new Error(data.message ?? "Stage error"));
          }
        });
        window.postMessage({ type: "load", ...payload }, location.origin);
      }),
    {
      spec: artifact.plan,
      meta: artifact.meta,
      timing: artifact.timing,
      captions: options.captions,
      layout: options.format,
      poster: Boolean(options.poster),
      render: true,
    },
  );
  return { page, sfx };
}

/**
 * Narration clips and effect hits, placed and balanced the way the live player
 * mixes them, then normalized to -16 LUFS: social feeds play loud, and a quiet
 * file sounds broken next to everything else. The pad before loudnorm keeps it
 * from clipping the tail.
 */
async function mixSoundtrack(
  dir: string,
  artifact: VideoArtifact,
  sfx: SfxCue[],
  origin: string,
  ffmpeg: string,
): Promise<string> {
  const inputs: string[] = [];
  const chains: string[] = [];
  const add = (path: string, chain: string) => {
    const index = inputs.length / 2;
    inputs.push("-i", path);
    chains.push(`[${index}:a]${chain}[a${index}]`);
  };
  const clips = await Promise.all(
    artifact.voices.map((_, index) =>
      readVoiceClip(
        artifact.meta.owner,
        artifact.meta.repo,
        artifact.createdAt,
        index,
      ),
    ),
  );
  for (const [index, clip] of clips.entries()) {
    if (!clip) throw new Error(`Narration clip ${index} is missing.`);
    const path = join(dir, `voice-${index}.mp3`);
    await writeFile(path, clip);
    const ms = Math.round(artifact.voices[index]!.start * 1000);
    add(
      path,
      `aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=${MASTER_GAIN}`,
    );
  }
  const effects = new Map<string, string>();
  for (const name of new Set(sfx.map((cue) => cue.name))) {
    if (!(name in SFX_PEAK_DB)) continue;
    const response = await fetch(
      `${origin}/video-engine/assets/sfx/${name}.mp3`,
    );
    if (!response.ok) continue;
    const path = join(dir, `sfx-${name}.mp3`);
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
    effects.set(name, path);
  }
  for (const cue of sfx) {
    const path = effects.get(cue.name);
    if (!path) continue;
    const ms = Math.round(cue.t * 1000);
    // A playback-rate change is a resample, which shifts pitch and length together.
    const rate = Math.round(44100 * (cue.rate ?? 1));
    add(
      path,
      `aresample=44100,asetrate=${rate},aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=${(MASTER_GAIN * sfxGain(cue.name, cue.gain)).toFixed(4)}`,
    );
  }
  const duration = artifact.timing.DURATION.toFixed(3);
  const labels = chains.map((_, index) => `[a${index}]`).join("");
  const graph = `${chains.join(";")};${labels}amix=inputs=${chains.length}:normalize=0:duration=longest,apad=whole_dur=${Number(duration) + 2},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,atrim=0:${duration}[mix]`;
  const out = join(dir, "soundtrack.wav");
  await run(ffmpeg, [
    "-y",
    "-loglevel",
    "error",
    ...inputs,
    "-filter_complex",
    graph,
    "-map",
    "[mix]",
    out,
  ]);
  return out;
}

/** Frames per segment. Segments render in parallel, each well inside a function's time limit. */
const SEGMENT_FRAMES = RENDER_FPS * 10;

/** The frame ranges [from, to) a film is cut into for parallel rendering. */
export function segmentRanges(
  artifact: VideoArtifact,
): Array<{ from: number; to: number }> {
  const frames = Math.ceil(artifact.timing.DURATION * RENDER_FPS);
  const ranges: Array<{ from: number; to: number }> = [];
  for (let from = 0; from < frames; from += SEGMENT_FRAMES)
    ranges.push({ from, to: Math.min(frames, from + SEGMENT_FRAMES) });
  return ranges;
}

/**
 * Render frames [from, to) of a film to a silent H.264 segment. The stage is
 * seeked frame by frame in headless Chromium and each screenshot is piped
 * straight into ffmpeg. Captions are burned in, since feeds autoplay muted.
 * Every segment uses identical settings, so they join without re-encoding.
 */
export async function renderVideoSegment(params: {
  artifact: VideoArtifact;
  format: RenderFormat;
  origin: string;
  from: number;
  to: number;
}): Promise<{ mp4: Buffer; sfx: SfxCue[] }> {
  const { artifact, format, origin } = params;
  const frame = FRAMES[format];
  const dir = await mkdtemp(join(tmpdir(), "explainer-"));
  const browser = await launchBrowser();
  try {
    const ffmpeg = await ffmpegPath();
    const { page, sfx } = await openStage(
      browser,
      origin,
      artifact,
      { format, captions: true },
      frame.width / frame.cssWidth,
    );
    const out = join(dir, "segment.mp4");
    const encoder = spawn(
      ffmpeg,
      [
        "-y",
        "-loglevel",
        "error",
        "-f",
        "image2pipe",
        "-framerate",
        String(RENDER_FPS),
        "-c:v",
        "mjpeg",
        "-i",
        "pipe:0",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-r",
        String(RENDER_FPS),
        out,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    let stderr = "";
    encoder.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    const finished = once(encoder, "close");
    const timings = { seek: 0, capture: 0, write: 0 };
    const opened = Date.now();
    for (let index = params.from; index < params.to; index++) {
      const a = Date.now();
      await page.evaluate(
        (time) => (window as unknown as StageWindow).__renderSeek(time),
        index / RENDER_FPS,
      );
      const b = Date.now();
      const jpeg = await page.screenshot({
        type: "jpeg",
        quality: 90,
        optimizeForSpeed: true,
      });
      const c = Date.now();
      if (!encoder.stdin.write(jpeg)) await once(encoder.stdin, "drain");
      timings.seek += b - a;
      timings.capture += c - b;
      timings.write += Date.now() - c;
    }
    encoder.stdin.end();
    const [code] = (await finished) as [number];
    if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${stderr}`);
    const frames = Math.max(1, params.to - params.from);
    console.info(
      JSON.stringify({
        event: "video.segment.rendered",
        frames,
        ms: Date.now() - opened,
        seekMs: Math.round(timings.seek / frames),
        captureMs: Math.round(timings.capture / frames),
        writeMs: Math.round(timings.write / frames),
      }),
    );
    return { mp4: await readFile(out), sfx };
  } finally {
    await browser.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Join rendered segments (in order) with the mixed soundtrack into the final MP4. */
export async function assembleMp4(params: {
  artifact: VideoArtifact;
  segments: Buffer[];
  sfx: SfxCue[];
  origin: string;
}): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "explainer-"));
  try {
    const ffmpeg = await ffmpegPath();
    const soundtrack = await mixSoundtrack(
      dir,
      params.artifact,
      params.sfx,
      params.origin,
      ffmpeg,
    );
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
    await run(ffmpeg, [
      "-y",
      "-loglevel",
      "error",
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
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      "-shortest",
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * A 1200×675 still of the first scene, finished: with a play button (the
 * poster link previews show on X, Reddit and chat apps) and without (the
 * thumbnail on /watch, which draws its own).
 */
export async function renderExplainerPoster(params: {
  artifact: VideoArtifact;
  origin: string;
}): Promise<{ poster: Buffer; still: Buffer }> {
  const { artifact, origin } = params;
  const browser = await launchBrowser();
  try {
    const { page } = await openStage(
      browser,
      origin,
      artifact,
      { format: "landscape", captions: false, poster: true },
      1200 / 1920,
    );
    const beats = artifact.plan.beats;
    let last = 0;
    while (beats[last + 1] && beats[last + 1]!.scene === beats[0]!.scene)
      last++;
    const time = Math.max(0, (artifact.timing.beats[last]?.end ?? 3) - 0.2);
    await page.evaluate(
      (at) => (window as unknown as StageWindow).__renderSeek(at),
      time,
    );
    const poster = Buffer.from(
      await page.screenshot({ type: "jpeg", quality: 86 }),
    );
    await page.evaluate(() => document.getElementById("poster")?.remove());
    const still = Buffer.from(
      await page.screenshot({ type: "jpeg", quality: 86 }),
    );
    return { poster, still };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
