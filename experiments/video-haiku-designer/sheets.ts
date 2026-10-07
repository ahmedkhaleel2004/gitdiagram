/**
 * Contact sheets: one frame at the end of every beat, from the real stage in
 * headless Chromium (serve.ts must be running; VIDEO_RENDER_CHROME_PATH set).
 * Per film: sheet.jpg (all beats, 4 across, for the page) and judge-N.jpg
 * (6 beats each, 3 across, so the judges can read the type).
 *
 *   bun experiments/video-haiku-designer/sheets.ts [repo,...]
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { VideoArtifact } from "~/features/explainer/types";
import puppeteer, { type Browser } from "puppeteer-core";
import { REPOS, RUNS, SETUP_NAMES, runDir } from "./lib";

const ORIGIN = process.env.STAGE_ORIGIN ?? "http://127.0.0.1:4599";
// As ../video-bespoke/frames.ts, but Chromium needs --no-sandbox on this
// server (the stage and the films are local files).
let shared: Promise<Browser> | null = null;
const browser = () =>
  (shared ??= puppeteer.launch({
    executablePath: process.env.VIDEO_RENDER_CHROME_PATH,
    headless: "shell",
    args: ["--no-sandbox", "--disable-gpu"],
  }));
const beatEnds = (artifact: VideoArtifact) =>
  artifact.timing.beats.map((b) => Math.max(b.start, b.end - 0.4));

async function openStage(artifact: VideoArtifact, scale: number) {
  const page = await (await browser()).newPage();
  await page.setViewport({
    width: 1920,
    height: 1080,
    deviceScaleFactor: scale,
  });
  await page.goto(`${ORIGIN}/video-engine/stage.html?v=${Date.now()}`, {
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

const W = 768;
const H = 432;

function tile(files: string[], cols: number, out: string) {
  const layout = files
    .map((_, i) => `${(i % cols) * W}_${Math.floor(i / cols) * H}`)
    .join("|");
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    ...files.flatMap((f) => ["-i", f]),
    "-filter_complex",
    files.length > 1
      ? `xstack=inputs=${files.length}:layout=${layout}:fill=black`
      : "null",
    "-frames:v",
    "1",
    "-q:v",
    "3",
    out,
  ]);
}

// SETTLED=1: a second look where every beat is followed by a 1.5 s hold and
// the frame is taken 1.2 s into it, so an animation cued on a beat's last
// words has finished (the first look catches some mid-move).
const SETTLED = process.env.SETTLED === "1";
const HOLD = 1.5;
const PREFIX = SETTLED ? "settled" : "judge";
const SHEET = SETTLED ? "sheet-settled.jpg" : "sheet.jpg";

function held(artifact: VideoArtifact): VideoArtifact {
  const beats = artifact.timing.beats.map((b, i) => ({
    start: +(b.start + i * HOLD).toFixed(3),
    end: +(b.end + i * HOLD).toFixed(3),
    words: b.words.map((w) => ({
      ...w,
      s: +(w.s + i * HOLD).toFixed(3),
      e: +(w.e + i * HOLD).toFixed(3),
    })),
  }));
  const extra = beats.length * HOLD;
  return {
    ...artifact,
    timing: {
      DURATION: artifact.timing.DURATION + extra,
      SPEECH_END: artifact.timing.SPEECH_END + extra - HOLD,
      beats,
    },
  };
}

async function sheet(dir: string) {
  const read = JSON.parse(
    await readFile(join(dir, "artifact.json"), "utf8"),
  ) as VideoArtifact;
  const artifact = SETTLED ? held(read) : read;
  const page = await openStage(artifact, 0.4);
  const frames = join(dir, SETTLED ? "frames-settled" : "frames");
  await rm(frames, { recursive: true, force: true });
  await mkdir(frames, { recursive: true });
  const files: string[] = [];
  const times = SETTLED
    ? artifact.timing.beats.map((b) => b.end + 1.2)
    : beatEnds(artifact);
  for (const [i, t] of times.entries()) {
    await page.evaluate(
      (time) =>
        (
          window as unknown as { __renderSeek: (t: number) => void }
        ).__renderSeek(time),
      t,
    );
    const file = join(frames, `${String(i).padStart(2, "0")}.jpg`);
    await page.screenshot({
      path: file as `${string}.jpg`,
      type: "jpeg",
      quality: 82,
    });
    files.push(file);
  }
  await page.close();
  tile(files, 4, join(dir, SHEET));
  for (let i = 0; i < files.length; i += 6)
    tile(files.slice(i, i + 6), 3, join(dir, `${PREFIX}-${i / 6}.jpg`));
}

const repos = process.argv[2]?.split(",") ?? REPOS;
for (const repo of repos)
  for (const setup of SETUP_NAMES)
    for (const run of RUNS) {
      const dir = runDir(repo, setup, run);
      if (!(await readFile(join(dir, "artifact.json")).catch(() => null)))
        continue;
      if (await readFile(join(dir, SHEET)).catch(() => null)) continue;
      try {
        await sheet(dir);
        console.info(`sheet ${repo} ${setup} r${run}`);
      } catch (error) {
        console.error(`✗ sheet ${repo} ${setup} r${run}`, error);
      }
    }
await (await browser()).close();
