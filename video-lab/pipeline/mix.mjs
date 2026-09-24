// Soundtrack: narration clips on the beat clock, a ducked music bed, and the SFX
// hits the composition declared (read from the running page), loudness-normalized.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const CHROME = join(
  process.env.HOME,
  "Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell",
);

export async function readSfx(dir) {
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.addInitScript(() => (window.__timelines = {}));
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("file://" + join(dir, "index.html"));
    for (let i = 0; ; i++) {
      if (await page.evaluate(() => Boolean(window.__timelines.main))) break;
      if (errors.length || i > 100) throw new Error("composition failed to build: " + errors.join("; "));
      await page.waitForTimeout(100);
    }
    return await page.evaluate(() => window.__SFX);
  } finally {
    await browser.close();
  }
}

const peaks = new Map();
function peak(file) {
  if (!peaks.has(file)) {
    const out = execFileSync("sh", ["-c", `ffmpeg -hide_banner -i "${file}" -af volumedetect -f null - 2>&1 | grep max_volume`], { encoding: "utf8" });
    peaks.set(file, Number(out.match(/max_volume: (-?[\d.]+) dB/)[1]));
  }
  return peaks.get(file);
}

export async function mix(dir, { voices, tempo = 1, duration, bed, loudness = { I: -16, TP: -1.5 }, out }) {
  const t0 = Date.now();
  const sfx = await readSfx(dir);
  const fmt = "aformat=sample_rates=48000:channel_layouts=stereo";
  const inputs = [];
  const chains = [];
  const labels = [];
  voices.forEach((v, k) => {
    const idx = inputs.push(join(dir, v.file)) - 1;
    const ms = Math.round(v.start * 1000);
    chains.push(`[${idx}:a]${fmt},atempo=${tempo},adelay=${ms}|${ms}[v${k}]`);
    labels.push(`[v${k}]`);
  });
  chains.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0,apad=whole_dur=${duration}[vo]`, `[vo]asplit=2[vo1][vosc]`);
  const mixLabels = ["[vo1]"];
  if (bed) {
    const idx = inputs.push(bed.file) - 1;
    chains.push(
      `[${idx}:a]${fmt},atrim=0:${duration},asetpts=PTS-STARTPTS,afade=t=in:d=1.2,afade=t=out:st=${(duration - 3).toFixed(2)}:d=3,volume=${bed.gainDb ?? -21}dB[bed]`,
      `[bed][vosc]sidechaincompress=threshold=0.015:ratio=4:attack=60:release=500:knee=4[bedd]`,
    );
    mixLabels.push("[bedd]");
  }
  sfx.forEach((e, k) => {
    const file = join(dir, "assets/sfx", `${e.name}.mp3`);
    if (!existsSync(file)) return;
    const idx = inputs.push(file) - 1;
    const ms = Math.round(e.t * 1000);
    chains.push(`[${idx}:a]${fmt},adelay=${ms}|${ms},volume=${(-6 - peak(file) + e.gain).toFixed(2)}dB[s${k}]`);
    mixLabels.push(`[s${k}]`);
  });
  const pre = `${mixLabels.join("")}amix=inputs=${mixLabels.length}:normalize=0:dropout_transition=0,apad=whole_dur=${duration + 3}`;
  const run = (graph, tail) => {
    const r = spawnSync("ffmpeg", ["-hide_banner", "-y", ...inputs.flatMap((f) => ["-i", f]), "-filter_complex", graph, "-map", "[out]", ...tail], {
      encoding: "utf8",
      maxBuffer: 1 << 26,
    });
    if (r.status !== 0) throw new Error("ffmpeg failed: " + r.stderr.slice(-800));
    return r.stderr;
  };
  // Two-pass loudnorm: measure, then apply linearly.
  const measured = run([...chains, `${pre},loudnorm=I=${loudness.I}:TP=${loudness.TP}:LRA=11:print_format=json[out]`].join(";"), ["-f", "null", "-"]);
  const m = JSON.parse(measured.slice(measured.lastIndexOf("{"), measured.lastIndexOf("}") + 1));
  const ln = `loudnorm=I=${loudness.I}:TP=${loudness.TP}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  run([...chains, `${pre},${ln},aresample=48000,apad=whole_dur=${duration},atrim=0:${duration}[out]`].join(";"), ["-c:a", "aac", "-b:a", "192k", out]);
  return { sfx: sfx.length, ms: Date.now() - t0 };
}
