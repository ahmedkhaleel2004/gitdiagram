import "server-only";

import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, statfs } from "node:fs/promises";
import { freemem, tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Page } from "puppeteer-core";
import type { SfxCue } from "~/features/explainer/audio-mixer";
import { STAGE_PATH } from "~/features/explainer/engine";
import type { VideoArtifact } from "~/features/explainer/types";
import { sourceTime, type TimeEdit } from "./feed-edit";
import {
  ffmpegPath,
  RENDER_FPS,
  videoCodecArgs,
  type RenderFormat,
} from "./ffmpeg";

// The stage lays out in CSS pixels at its native size; the device scale factor
// turns that into the output resolution.
const FRAMES: Record<
  RenderFormat,
  { cssWidth: number; cssHeight: number; width: number; height: number }
> = {
  landscape: { cssWidth: 1920, cssHeight: 1080, width: 1280, height: 720 },
  vertical: { cssWidth: 1080, cssHeight: 1920, width: 1080, height: 1920 },
};

/**
 * The vertical MP4 is the engine's tall reel layout, as a feed cut (see
 * stage.js). What Shorts, Reels and TikTok lay over a video's edges (their top
 * bar, the caption and account under it, the button column on the right),
 * in pixels of the 1080×1920 frame: the scene and captions keep clear of it.
 */
const FEED_INSETS = { top: 140, bottom: 320, right: 150 };

type StageWindow = Window & { __renderSeek: (time: number) => void };

/** Launch Chromium with its profile in `dir`, which the caller removes. */
async function launchBrowser(dir: string): Promise<Browser> {
  const userDataDir = join(dir, "profile");
  const puppeteer = (await import("puppeteer-core")).default;
  const executablePath = process.env.VIDEO_RENDER_CHROME_PATH?.trim();
  if (!executablePath)
    throw new Error(
      "Set VIDEO_RENDER_CHROME_PATH to a headless Chromium to render locally.",
    );
  // Extra Chromium flags for this host, such as a container's --no-sandbox.
  const args =
    process.env.VIDEO_RENDER_CHROME_ARGS?.split(/\s+/).filter(Boolean);
  return puppeteer.launch({
    executablePath,
    headless: "shell",
    userDataDir,
    // Puppeteer would close Chromium on the server's stop signal; a container
    // finishes its renders first (drain.ts), and every render closes its own.
    handleSIGTERM: false,
    handleSIGINT: false,
    handleSIGHUP: false,
    ...(args?.length ? { args } : {}),
  });
}

const closings = new WeakMap<Browser, Promise<void>>();

/**
 * Close Chromium and everything it started, once however often it is asked.
 * close() kills the browser's process group once it exits; a crashed or hung
 * Chromium can stall that, so the group is killed outright if it has not gone
 * within a few seconds.
 */
function closeBrowser(browser: Browser | null): Promise<void> {
  if (!browser) return Promise.resolve();
  let closing = closings.get(browser);
  if (!closing) closings.set(browser, (closing = shutDown(browser)));
  return closing;
}

async function shutDown(browser: Browser) {
  const child = browser.process();
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    browser.close().catch(() => undefined),
    new Promise((resolve) => (timer = setTimeout(resolve, 5_000))),
  ]);
  clearTimeout(timer);
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

/**
 * What a render host has left, for failure logs: an instance that runs short
 * of memory or disk makes Chromium fail in unhelpful ways ("Target closed",
 * network errors) on every later render.
 */
export async function renderHostStats() {
  const freeMb = async (path: string) => {
    const stats = await statfs(path).catch(() => null);
    return stats ? Math.round((stats.bavail * stats.bsize) / 2 ** 20) : null;
  };
  return {
    memFreeMb: Math.round(freemem() / 2 ** 20),
    tmpFreeMb: await freeMb(tmpdir()),
    shmFreeMb: await freeMb("/dev/shm"),
  };
}

export interface Encoder {
  readonly pid: number | undefined;
  /** Feed one chunk, waiting while ffmpeg catches up; rejects once it has exited. */
  write(chunk: Uint8Array): Promise<void>;
  /** Close stdin and wait for ffmpeg to finish; rejects unless it exited cleanly. */
  finish(): Promise<void>;
  /** Kill ffmpeg if it is still running and wait for it to be reaped. Never throws. */
  kill(): Promise<void>;
}

/**
 * An ffmpeg fed through stdin. However it ends (it fails to start, crashes, or
 * the render around it fails) nothing waits on it forever: a write races the
 * pipe draining against ffmpeg exiting, and kill() ends a still-running one,
 * which would otherwise sit on stdin holding its memory and output file.
 */
export function startEncoder(binary: string, args: string[]): Encoder {
  const child = spawn(binary, args, { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-2000);
  });
  // Writing to an ffmpeg that has exited raises EPIPE here; `exited` reports it.
  child.stdin.on("error", () => undefined);
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code: number | null) => resolve(code));
  });
  // Awaited by write(), finish() and kill(); this keeps a failed spawn from
  // going unhandled before any of them runs.
  exited.catch(() => undefined);
  const stopped = () =>
    exited.then(
      (code) => new Error(`ffmpeg exited early (${code}): ${stderr}`),
      (error: unknown) => error,
    );

  return {
    pid: child.pid,
    async write(chunk) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw await stopped();
      if (child.stdin.write(chunk)) return;
      const waiting = new AbortController();
      try {
        await Promise.race([
          once(child.stdin, "drain", { signal: waiting.signal }),
          stopped().then((error) => Promise.reject(error)),
        ]);
      } finally {
        waiting.abort();
      }
    },
    async finish() {
      child.stdin.end();
      const code = await exited;
      if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${stderr}`);
    },
    async kill() {
      if (child.exitCode === null && child.signalCode === null) {
        child.stdin.destroy();
        child.kill("SIGKILL");
      }
      await exited.catch(() => undefined);
    },
  };
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
      poster: Boolean(options.poster),
      render: true,
      ...(options.format === "vertical"
        ? { layout: "reel", feed: true, height: 1920, insets: FEED_INSETS }
        : { layout: options.format }),
    },
  );
  return { page, sfx };
}

/**
 * Render frames [from, to) of a film to a silent H.264 segment. The stage is
 * seeked frame by frame in headless Chromium and each screenshot is piped
 * straight into ffmpeg. Captions are burned in, since feeds autoplay muted.
 * Every segment uses identical settings, so they join without re-encoding.
 * Aborting `signal` stops the render at once and kills Chromium and ffmpeg.
 */
export async function renderVideoSegment(params: {
  artifact: VideoArtifact;
  format: RenderFormat;
  origin: string;
  from: number;
  to: number;
  /** The vertical MP4's feed cut: frame times are on its clock (see feed-edit.ts). */
  edit?: TimeEdit;
  signal?: AbortSignal;
  /** The stage is built; its effect cues are known. */
  onReady?: (sfx: SfxCue[]) => void;
  /** Frames captured so far in this segment. */
  onFrame?: (done: number) => void;
}): Promise<Buffer> {
  const { artifact, format, origin, signal } = params;
  signal?.throwIfAborted();
  const frame = FRAMES[format];
  const dir = await mkdtemp(join(tmpdir(), "explainer-"));
  let browser: Browser | null = null;
  let encoder: Encoder | null = null;
  // Killing the children makes whatever the render is waiting on fail at once.
  const stop = () => Promise.all([encoder?.kill(), closeBrowser(browser)]);
  signal?.addEventListener("abort", stop);
  try {
    browser = await launchBrowser(dir);
    signal?.throwIfAborted();
    const ffmpeg = await ffmpegPath();
    const { page, sfx } = await openStage(
      browser,
      origin,
      artifact,
      { format, captions: true },
      frame.width / frame.cssWidth,
    );
    params.onReady?.(sfx);
    const out = join(dir, "segment.mp4");
    encoder = startEncoder(ffmpeg, [
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
      ...videoCodecArgs(format),
      "-r",
      String(RENDER_FPS),
      out,
    ]);
    const { edit } = params;
    for (let index = params.from; index < params.to; index++) {
      signal?.throwIfAborted();
      const time = index / RENDER_FPS;
      await page.evaluate(
        (at) => (window as unknown as StageWindow).__renderSeek(at),
        edit ? sourceTime(edit, time) : time,
      );
      const jpeg = await page.screenshot({
        type: "jpeg",
        // Thin lines and small text at full 1080×1920 are worth a finer frame.
        quality: format === "vertical" ? 94 : 90,
        optimizeForSpeed: true,
      });
      await encoder.write(jpeg);
      params.onFrame?.(index + 1 - params.from);
    }
    await encoder.finish();
    signal?.throwIfAborted();
    return await readFile(out);
  } finally {
    signal?.removeEventListener("abort", stop);
    await stop();
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * A 1200×675 still of the first scene, finished: with a play button (the
 * poster link previews show on X, Reddit and chat apps) and without (the
 * thumbnail on /videos, which draws its own).
 */
export async function renderExplainerPoster(params: {
  artifact: VideoArtifact;
  origin: string;
}): Promise<{ poster: Buffer; still: Buffer }> {
  const { artifact, origin } = params;
  const dir = await mkdtemp(join(tmpdir(), "explainer-"));
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser(dir);
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
    await closeBrowser(browser);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
