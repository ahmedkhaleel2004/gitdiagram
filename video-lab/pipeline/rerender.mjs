#!/usr/bin/env node
// Re-render a finished run with the current engine, reusing its plan and narration:
// no model call and no TTS, so it costs nothing and takes about 40 seconds.
//   node pipeline/rerender.mjs runs/<slug> [--fps 30] [--workers 6]
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mix } from "./mix.mjs";

const LAB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(process.argv[2]);
const flag = (k, d) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d);
const t0 = Date.now();
for (const f of ["engine.js", "engine.css"]) cpSync(join(LAB, "..", "public", "video-engine", f), join(dir, f));
cpSync(join(LAB, "engine", "index.html"), join(dir, "index.html"));
const sound = JSON.parse(readFileSync(join(dir, "sound.json"), "utf8"));
const html = join(dir, "index.html");
execFileSync("sed", ["-i", "", `s/data-duration="[0-9.]*"/data-duration="${sound.duration}"/`, html]);
const [r] = await Promise.all([
  new Promise((ok) => ok(spawnSync("npx", ["--yes", "hyperframes@0.8.69", "render", "-o", join(dir, "video.mp4"), "--fps", flag("fps", "30"), "--quality", "looks", "--workers", flag("workers", "6"), "--quiet"], { cwd: dir, encoding: "utf8" }))),
  mix(dir, { ...sound, bed: { file: join(dir, "assets/music/bed-a.mp3"), gainDb: -21 }, out: join(dir, "soundtrack.m4a") }),
]);
if (r.status !== 0) throw new Error("render failed: " + (r.stderr || r.stdout).slice(-1500));
const out = join(dir, readdirSync(dir).find((f) => f.endsWith(".mp4") && f !== "video.mp4") || `${basename(dir)}.mp4`);
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", join(dir, "video.mp4"), "-i", join(dir, "soundtrack.m4a"), "-map", "0:v", "-map", "1:a", "-c", "copy", "-shortest", "-movflags", "+faststart", out]);
console.log(`${out} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
