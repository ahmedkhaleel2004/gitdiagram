/**
 * Fast looks at a film without rendering an MP4: open the real stage, seek to
 * chosen times and screenshot. Used to judge visual experiments quickly.
 *
 *   bun experiments/video-bespoke/frames.ts <artifact.json> <out-prefix> [sheet|strip:<from>-<to>@<fps>]
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";
import type { VideoArtifact } from "~/features/explainer/types";

const CHROME =
  process.env.VIDEO_RENDER_CHROME_PATH ||
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const ORIGIN = process.env.STAGE_ORIGIN ?? "http://127.0.0.1:4599";

let shared: Promise<Browser> | null = null;
export function browser() {
  shared ??= puppeteer.launch({ executablePath: CHROME, headless: "shell" });
  return shared;
}

export async function openStage(artifact: VideoArtifact, scale = 0.5) {
  const page = await (await browser()).newPage();
  await page.setViewport({
    width: 1920,
    height: 1080,
    deviceScaleFactor: scale,
  });
  const v = Date.now();
  await page.goto(`${ORIGIN}/video-engine/stage.html?v=${v}`, {
    waitUntil: "load",
  });
  await page.evaluate(
    (payload) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("stage timeout")),
          25_000,
        );
        window.addEventListener("message", (event: MessageEvent) => {
          const data = event.data as { type?: string; message?: string };
          if (data?.type === "ready") {
            clearTimeout(timer);
            resolve();
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
      captions: true,
      layout: "landscape",
      poster: false,
      render: true,
    },
  );
  return page;
}

/** Screenshot the stage at each time, then tile them `cols` wide. */
export async function grab(
  artifact: VideoArtifact,
  times: number[],
  out: string,
  cols = 4,
  scale = 0.5,
) {
  const page = await openStage(artifact, scale);
  const dir = `${out}.frames`;
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  for (const [i, t] of times.entries()) {
    await page.evaluate(
      (time) =>
        (
          window as unknown as { __renderSeek: (t: number) => void }
        ).__renderSeek(time),
      t,
    );
    const file = `${dir}/${String(i).padStart(3, "0")}.jpg`;
    await page.screenshot({
      path: file as `${string}.jpg`,
      type: "jpeg",
      quality: 80,
    });
    files.push(file);
  }
  await page.close();
  const w = 1920 * scale;
  const h = 1080 * scale;
  const inputs = files.flatMap((f) => ["-i", f]);
  const layout = files
    .map((_, i) => `${(i % cols) * w}_${Math.floor(i / cols) * h}`)
    .join("|");
  await mkdir(dirname(out), { recursive: true });
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    ...inputs,
    "-filter_complex",
    files.length > 1
      ? `xstack=inputs=${files.length}:layout=${layout}:fill=black`
      : "null",
    "-frames:v",
    "1",
    "-q:v",
    "3",
    `${out}.jpg`,
  ]);
  await rm(dir, { recursive: true, force: true });
  return `${out}.jpg`;
}

/** One frame at the end of every beat (just before the next starts). */
export function beatEnds(artifact: VideoArtifact) {
  return artifact.timing.beats.map((b) => Math.max(b.start, b.end - 0.4));
}

if (import.meta.main) {
  const [path, out, mode = "sheet"] = process.argv.slice(2) as [
    string,
    string,
    string?,
  ];
  const artifact = JSON.parse(await readFile(path, "utf8")) as VideoArtifact;
  let times = beatEnds(artifact);
  let cols = 4;
  const strip = /^strip:([\d.]+)-([\d.]+)@([\d.]+)$/.exec(mode);
  if (strip) {
    const [from, to, fps] = strip.slice(1).map(Number) as [
      number,
      number,
      number,
    ];
    times = [];
    for (let t = from; t <= to; t += 1 / fps) times.push(t);
    cols = 5;
  }
  console.info(await grab(artifact, times, out, cols));
  await (await browser()).close();
}
