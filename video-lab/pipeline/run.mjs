#!/usr/bin/env node
// Any GitHub repository → a narrated ~60s explainer video.
//   node pipeline/run.mjs <owner/repo | github url> [--effort low] [--fps 30] [--workers 6] [--spec plan.json]
import { spawn, execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ingest } from "./ingest.mjs";
import { plan } from "./plan.mjs";
import { normalize } from "./schema.mjs";
import { voice } from "./voice.mjs";
import { mix } from "./mix.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const LAB = resolve(here, "..");
const argv = process.argv.slice(2);
const flag = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const input = argv.find((a) => !a.startsWith("--") && !argv[argv.indexOf(a) - 1]?.startsWith("--"));
if (!input) {
  console.error("usage: run.mjs <owner/repo> [--effort low] [--fps 30] [--workers 6] [--spec plan.json]");
  process.exit(1);
}

const T0 = Date.now();
const lap = {};
const time = async (name, fn) => {
  const t = Date.now();
  const r = await fn();
  lap[name] = (Date.now() - t) / 1000;
  log(`${name} ${lap[name].toFixed(1)}s`);
  return r;
};
const log = (m) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(5)}s] ${m}`);

const ctx = await time("ingest", () => ingest(input));
const slug = `${ctx.owner}__${ctx.repo}`.toLowerCase();
const dir = resolve(flag("out", join(LAB, "runs", slug)));
mkdirSync(dir, { recursive: true });

// Copy the engine template while the model plans.
cpSync(join(LAB, "engine"), dir, { recursive: true });

let planned;
if (flag("spec")) {
  planned = { spec: JSON.parse(readFileSync(flag("spec"), "utf8")).raw ?? JSON.parse(readFileSync(flag("spec"), "utf8")), costUsd: 0, usage: {}, reused: true };
  lap.plan = 0;
} else {
  planned = await time("plan", () => plan(ctx, { effort: flag("effort", "low") }));
}
const { spec, warnings } = normalize(structuredClone(planned.spec), ctx);
writeFileSync(join(dir, "plan.json"), JSON.stringify({ raw: planned.spec, spec, warnings, usage: planned.usage, costUsd: planned.costUsd }, null, 1));
if (warnings.length) log(`plan warnings: ${warnings.join(" | ")}`);

const vo = await time("voice", () => voice(spec, dir));
const meta = {
  owner: ctx.owner,
  repo: ctx.repo,
  url: ctx.url,
  description: ctx.meta.description,
  stars: ctx.meta.stars,
  language: ctx.meta.language,
};
writeFileSync(join(dir, "spec.js"), `window.SPEC = ${JSON.stringify(spec)};\nwindow.META = ${JSON.stringify(meta)};\n`);
writeFileSync(join(dir, "timing.js"), `window.TIMING = ${JSON.stringify(vo.timing)};\n`);
const html = readFileSync(join(dir, "index.html"), "utf8").replace(/(id="root"[^>]*data-duration=")[\d.]+/, `$1${vo.timing.DURATION}`);
writeFileSync(join(dir, "index.html"), html);
writeFileSync(join(dir, "sound.json"), JSON.stringify({ voices: vo.voices, tempo: vo.tempo, duration: vo.timing.DURATION }, null, 1));
writeFileSync(join(dir, "package.json"), JSON.stringify({ name: slug.replace(/[^a-z0-9-]/g, "-"), private: true, type: "module" }));

// Picture and sound in parallel, then join them.
const render = () =>
  new Promise((ok, fail) => {
    const args = ["--yes", "hyperframes@0.8.69", "render", "-o", join(dir, "video.mp4"), "--fps", flag("fps", "30"), "--quality", "looks", "--workers", flag("workers", "6"), "--quiet"];
    const p = spawn("npx", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.stdout.on("data", (d) => (err += d));
    p.on("close", (c) => (c === 0 ? ok() : fail(new Error("render failed: " + err.slice(-1500)))));
  });
await Promise.all([
  time("render", render),
  time("mix", () =>
    mix(dir, {
      voices: vo.voices,
      tempo: vo.tempo,
      duration: vo.timing.DURATION,
      bed: { file: join(dir, "assets/music/bed-a.mp3"), gainDb: -21 },
      out: join(dir, "soundtrack.m4a"),
    }),
  ),
]);
const final = join(dir, `${slug}.mp4`);
await time("mux", async () =>
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", join(dir, "video.mp4"), "-i", join(dir, "soundtrack.m4a"), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "copy", "-shortest", "-movflags", "+faststart", final]),
);

const total = (Date.now() - T0) / 1000;
const report = {
  repo: `${ctx.owner}/${ctx.repo}`,
  output: final,
  video_seconds: vo.timing.DURATION,
  total_seconds: +total.toFixed(1),
  stages_seconds: lap,
  planner: { effort: flag("effort", "low"), cost_usd: planned.costUsd, usage: planned.usage, reused: Boolean(planned.reused) },
  tts: { characters: vo.chars, beats: spec.beats.length },
  scenes: spec.beats.map((b) => b.scene.type),
  words: spec.beats.map((b) => b.narration).join(" ").split(/\s+/).length,
  warnings,
};
writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));
log(`done → ${final}`);
console.log(JSON.stringify({ total_seconds: report.total_seconds, stages: lap, cost_usd: planned.costUsd, video_seconds: report.video_seconds }, null, 1));
