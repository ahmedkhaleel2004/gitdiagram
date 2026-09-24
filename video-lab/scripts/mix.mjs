#!/usr/bin/env node
// Build a project's soundtrack from its composition.
//   node mix.mjs <project-dir>
//
// 1. Loads index.html headlessly and reads window.__SFX — the sound cues the
//    composition declared next to the animations that cause them — so picture
//    and sound share one source of truth.
// 2. Mixes narration (time-stretched by sound.json's tempo), the music bed
//    (ducked under the voice), and every SFX hit (peak-normalized, then gained).
// 3. Two-pass loudnorm to the target LUFS → assets/audio/soundtrack.wav
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const dir = resolve(process.argv[2] || ".");
const sound = JSON.parse(readFileSync(join(dir, "sound.json"), "utf8"));
const CHROME = join(
  process.env.HOME,
  "Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell",
);

async function readComposition() {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(() => {
    window.__timelines = {};
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("file://" + join(dir, "index.html"));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("ERR_FILE_NOT_FOUND") && errors.push(m.text()));
  for (let i = 0; ; i++) {
    if (await page.evaluate(() => Boolean(window.__timelines && window.__timelines.main))) break;
    if (i > 75) throw new Error("timeline never registered: " + errors.join("; "));
    await page.waitForTimeout(200);
  }
  const data = await page.evaluate(() => ({
    sfx: window.__SFX,
    duration: window.TIMING.DURATION,
    tlDuration: window.__timelines.main.duration(),
  }));
  await browser.close();
  if (errors.length) throw new Error("composition errors:\n" + errors.join("\n"));
  return data;
}

function peakDb(file) {
  const out = execFileSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
  return out;
}

function maxVolume(file) {
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch {}
  const res = execFileSync(
    "sh",
    ["-c", `ffmpeg -hide_banner -i "${file}" -af volumedetect -f null - 2>&1 | grep max_volume`],
    { encoding: "utf8" },
  );
  return Number(res.match(/max_volume: (-?[\d.]+) dB/)[1]);
}

const t0 = Date.now();
const comp = await readComposition();
const DUR = comp.duration;
const { tempo = 1, voStart = 0.5 } = sound;
const SFX_PEAK = -6; // every effect is normalized to this peak before its event gain

const inputs = [];
const chains = [];
const mixLabels = [];
const fmt = "aformat=sample_rates=48000:channel_layouts=stereo";

// voice
inputs.push(join(dir, sound.voice.file));
const voMs = Math.round(voStart * 1000);
chains.push(`[0:a]${fmt},atempo=${tempo},adelay=${voMs}|${voMs},volume=${sound.voice.gainDb ?? 0}dB,apad=whole_dur=${DUR}[vo]`);
chains.push(`[vo]asplit=2[vo1][vosc]`);
mixLabels.push("[vo1]");

// bed, ducked under the voice
if (sound.bed) {
  inputs.push(join(dir, sound.bed.file));
  const b = sound.bed;
  chains.push(
    `[1:a]${fmt},atrim=0:${DUR},asetpts=PTS-STARTPTS,afade=t=in:d=${b.fadeIn ?? 1}` +
      `,afade=t=out:st=${(DUR - (b.fadeOut ?? 3)).toFixed(2)}:d=${b.fadeOut ?? 3},volume=${b.gainDb}dB[bed]`,
  );
  chains.push(
    `[bed][vosc]sidechaincompress=threshold=0.015:ratio=${b.duckRatio ?? 4}:attack=60:release=500:knee=4[bedd]`,
  );
  mixLabels.push("[bedd]");
}

// sfx
const peaks = {};
comp.sfx.forEach((e, i) => {
  const file = join(dir, "assets/sfx", `${e.name}.mp3`);
  if (!existsSync(file)) throw new Error("missing sfx " + file);
  peaks[e.name] ??= maxVolume(file);
  const gain = SFX_PEAK - peaks[e.name] + e.gain;
  const idx = inputs.push(file) - 1;
  const ms = Math.max(0, Math.round(e.t * 1000));
  chains.push(`[${idx}:a]${fmt},adelay=${ms}|${ms},volume=${gain.toFixed(2)}dB[s${i}]`);
  mixLabels.push(`[s${i}]`);
});

const pre = `${mixLabels.join("")}amix=inputs=${mixLabels.length}:normalize=0:dropout_transition=0,apad=whole_dur=${DUR + 3}`;
const graph1 = [...chains, `${pre},loudnorm=I=${sound.loudness.I}:TP=${sound.loudness.TP}:LRA=11:print_format=json[out]`].join(";");
const args = (graph, out) => [
  "-hide_banner",
  "-y",
  ...inputs.flatMap((f) => ["-i", f]),
  "-filter_complex",
  graph,
  "-map",
  "[out]",
  ...out,
];

// pass 1: measure
const measure = execFileSync(
  "sh",
  ["-c", `ffmpeg ${args(graph1, ["-f", "null", "-"]).map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")} 2>&1`],
  { encoding: "utf8", maxBuffer: 1 << 26 },
);
const m = JSON.parse(measure.slice(measure.lastIndexOf("{"), measure.lastIndexOf("}") + 1));
const ln =
  `loudnorm=I=${sound.loudness.I}:TP=${sound.loudness.TP}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}` +
  `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
const graph2 = [...chains, `${pre},${ln},aresample=48000,apad=whole_dur=${DUR},atrim=0:${DUR}[out]`].join(";");
const out = join(dir, "assets/audio/soundtrack.wav");
execFileSync("ffmpeg", args(graph2, ["-c:a", "pcm_s16le", out]), { stdio: ["ignore", "ignore", "pipe"] });

const report = {
  duration: DUR,
  timeline_duration: comp.tlDuration,
  sfx_events: comp.sfx.length,
  measured_in: { I: m.input_i, TP: m.input_tp },
  out,
  ms: Date.now() - t0,
};
writeFileSync(join(dir, "assets/audio/mix-report.json"), JSON.stringify({ ...report, sfx: comp.sfx }, null, 2));
console.log(JSON.stringify(report, null, 2));
