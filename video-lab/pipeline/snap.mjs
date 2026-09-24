#!/usr/bin/env node
// Fast visual check without a full render: refresh a run's engine files, snapshot
// every beat's end state with HyperFrames, and tile them into contact sheets.
//   node pipeline/snap.mjs runs/<slug> [--mid]
import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LAB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(process.argv[2]);
for (const f of ["engine.js", "engine.css"]) cpSync(join(LAB, "..", "public", "video-engine", f), join(dir, f));
const T = JSON.parse(readFileSync(join(dir, "timing.js"), "utf8").replace(/^window\.TIMING = /, "").replace(/;\s*$/, ""));
const mid = process.argv.includes("--mid");
const at = T.beats.map((b, i) => (mid ? (b.start + b.end) / 2 : Math.max(b.start, (T.beats[i + 1]?.start ?? T.DURATION) - 0.7)).toFixed(2));
rmSync(join(dir, "snapshots"), { recursive: true, force: true });
execFileSync("npx", ["--yes", "hyperframes@0.8.69", "snapshot", "--at", at.join(","), "--no-end", "--describe", "false"], { cwd: dir, stdio: "ignore" });
const frames = readdirSync(join(dir, "snapshots")).filter((f) => f.startsWith("frame-")).sort();
for (let k = 0; k < frames.length; k += 9) {
  const g = frames.slice(k, k + 9);
  while (g.length < 9) g.push(g.at(-1));
  execFileSync("ffmpeg", ["-v", "error", "-y", ...g.flatMap((f) => ["-i", join(dir, "snapshots", f)]),
    "-filter_complex", "[0]scale=640:360[p0];[1]scale=640:360[p1];[2]scale=640:360[p2];[3]scale=640:360[p3];[4]scale=640:360[p4];[5]scale=640:360[p5];[6]scale=640:360[p6];[7]scale=640:360[p7];[8]scale=640:360[p8];[p0][p1][p2]hstack=3[a];[p3][p4][p5]hstack=3[b];[p6][p7][p8]hstack=3[c];[a][b][c]vstack=3[o]",
    "-map", "[o]", "-q:v", "3", join(dir, "snapshots", `sheet-${k / 9}.jpg`)]);
  console.log(join(dir, "snapshots", `sheet-${k / 9}.jpg`));
}
