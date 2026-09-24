#!/usr/bin/env node
// Pull each beat's most complete frame (just before it hands off) from a run's MP4
// and tile them into 3x3 contact sheets for review.
//   node pipeline/review.mjs runs/<slug> [--mid]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = resolve(process.argv[2]);
const mid = process.argv.includes("--mid");
const T = JSON.parse(readFileSync(join(dir, "timing.js"), "utf8").replace(/^window\.TIMING = /, "").replace(/;\s*$/, ""));
const mp4 = readdirSync(dir).find((f) => f.endsWith(".mp4") && f !== "video.mp4");
const out = join(dir, "review");
mkdirSync(out, { recursive: true });
const times = T.beats.map((b, i) => {
  const next = T.beats[i + 1]?.start ?? T.DURATION;
  return mid ? (b.start + b.end) / 2 : Math.max(b.start, next - 0.7);
});
times.forEach((t, i) =>
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", t.toFixed(2), "-i", join(dir, mp4), "-frames:v", "1", "-vf", "scale=640:360", join(out, `b${String(i).padStart(2, "0")}.png`)]),
);
const frames = readdirSync(out).filter((f) => /^b\d+\.png$/.test(f)).sort();
for (let k = 0; k < frames.length; k += 9) {
  const g = frames.slice(k, k + 9);
  while (g.length < 9) g.push(g.at(-1));
  execFileSync("ffmpeg", [
    "-v", "error", "-y",
    ...g.flatMap((f) => ["-i", join(out, f)]),
    "-filter_complex", "[0][1][2]hstack=3[a];[3][4][5]hstack=3[b];[6][7][8]hstack=3[c];[a][b][c]vstack=3[o]",
    "-map", "[o]", "-q:v", "3", join(out, `sheet-${k / 9}.jpg`),
  ]);
  console.log(join(out, `sheet-${k / 9}.jpg`));
}
