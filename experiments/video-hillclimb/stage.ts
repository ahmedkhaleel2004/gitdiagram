// Opens a film on the real stage in headless Chromium (serve.ts running).
import { execFileSync } from "node:child_process";
import type { VideoArtifact } from "~/features/explainer/types";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

const ORIGIN = process.env.STAGE_ORIGIN ?? "http://127.0.0.1:4611";
const CHROME =
  process.env.VIDEO_RENDER_CHROME_PATH ??
  `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`;
let shared: Promise<Browser> | null = null;
export const browser = () =>
  (shared ??= puppeteer.launch({
    executablePath: CHROME,
    headless: "shell",
    args: ["--no-sandbox", "--disable-gpu"],
  }));
export async function closeBrowser() {
  if (shared) await (await shared).close();
  shared = null;
}

export const HOLD = 1.5;
/** The film with a hold after every beat, so a frame can be taken settled. */
export function held(artifact: VideoArtifact): VideoArtifact {
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

export async function openStage(
  artifact: VideoArtifact,
  scale = 0.5,
): Promise<Page> {
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

export const seek = (page: Page, t: number) =>
  page.evaluate(
    (time) =>
      (window as unknown as { __renderSeek: (t: number) => void }).__renderSeek(
        time,
      ),
    t,
  );

const W = 768;
const H = 432;
export function tile(files: string[], cols: number, out: string) {
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
      ? `${files.map((_, i) => `[${i}:v]scale=${W}:${H}[s${i}]`).join(";")};${files.map((_, i) => `[s${i}]`).join("")}xstack=inputs=${files.length}:layout=${layout}:fill=black`
      : `scale=${W}:${H}`,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    out,
  ]);
}
