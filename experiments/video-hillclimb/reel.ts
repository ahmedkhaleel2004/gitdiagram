// A film's reel (tall) layout, a few beats side by side:
//   bun experiments/video-hillclimb/reel.ts <film dir> <beat,beat,...> <out.jpg>
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoArtifact } from "~/features/explainer/types";
import { HOLD, browser, closeBrowser, held } from "./stage";

const [dir, beats, out] = process.argv.slice(2);
const artifact = held(
  JSON.parse(
    await readFile(join(dir!, "artifact.json"), "utf8"),
  ) as VideoArtifact,
);
const page = await (await browser()).newPage();
await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 0.35 });
await page.goto(
  `http://127.0.0.1:4611/video-engine/stage.html?v=${Date.now()}`,
  { waitUntil: "load" },
);
await page.evaluate(
  (payload) =>
    new Promise<void>((resolve, reject) => {
      setTimeout(() => reject(new Error("stage timeout")), 25_000);
      window.addEventListener("message", (event: MessageEvent) => {
        const data = event.data as { type?: string; message?: string };
        if (data?.type === "ready") resolve();
        else if (data?.type === "error") reject(new Error(data.message));
      });
      window.postMessage({ type: "load", ...payload }, location.origin);
    }),
  {
    spec: artifact.plan,
    meta: artifact.meta,
    timing: artifact.timing,
    captions: true,
    layout: "reel",
    height: 1920,
    feed: true,
    render: true,
  },
);
const files: string[] = [];
for (const b of beats!.split(",")) {
  await page.evaluate(
    (t) =>
      (window as unknown as { __renderSeek: (t: number) => void }).__renderSeek(
        t,
      ),
    artifact.timing.beats[Number(b)]!.end + HOLD * 0.8,
  );
  const file = `/tmp/reel-${b}.jpg`;
  await page.screenshot({
    path: file as `${string}.jpg`,
    type: "jpeg",
    quality: 80,
  });
  files.push(file);
}
execFileSync("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  ...files.flatMap((f) => ["-i", f]),
  "-filter_complex",
  `hstack=inputs=${files.length}`,
  "-frames:v",
  "1",
  out!,
]);
await closeBrowser();
