#!/usr/bin/env node
// Print an audio file's loudness envelope so sync points can be checked without listening.
//   node envelope.mjs file.mp3 [--win 0.02] [--width 60]
import { execFileSync } from "node:child_process";

const file = process.argv[2];
const win = Number(process.argv[process.argv.indexOf("--win") + 1] || 0) || 0.02;
const width = Number(process.argv[process.argv.indexOf("--width") + 1] || 0) || 0;
const rate = 22050;
const raw = execFileSync(
  "ffmpeg",
  ["-v", "error", "-i", file, "-ac", "1", "-ar", String(rate), "-f", "f32le", "-"],
  { maxBuffer: 1 << 30 },
);
const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
const n = Math.floor(win * rate);
const db = [];
for (let i = 0; i + n <= pcm.length; i += n) {
  let s = 0;
  for (let j = i; j < i + n; j++) s += pcm[j] * pcm[j];
  db.push(10 * Math.log10(s / n + 1e-12));
}
const peak = Math.max(...db);
const peakAt = db.indexOf(peak) * win;
const onset = db.findIndex((d) => d > peak - 24) * win;
const tailIdx = db.length - 1 - [...db].reverse().findIndex((d) => d > peak - 36);
const dur = pcm.length / rate;
console.log(
  `${file}  dur=${dur.toFixed(2)}s onset=${onset.toFixed(3)}s peakAt=${peakAt.toFixed(3)}s audibleUntil=${(tailIdx * win).toFixed(2)}s peakRms=${peak.toFixed(1)}dB`,
);
if (width) {
  const step = Math.max(1, Math.floor(db.length / width));
  let line = "";
  for (let i = 0; i < db.length; i += step) {
    const d = Math.max(...db.slice(i, i + step));
    line += " ▁▂▃▄▅▆▇█"[Math.max(0, Math.min(8, Math.round(((d - (peak - 48)) / 48) * 8)))];
  }
  console.log("  " + line);
}
