/**
 * Planner model experiment: the same repository input, written and designed by
 * different models, narrated and rendered the same way.
 *
 *   bun --conditions=react-server experiments/video-models/run.ts generate
 *   bun --conditions=react-server experiments/video-models/run.ts render
 *
 * Output lands in experiments/video-models/out (ignored by git).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoArtifact } from "~/features/explainer/types";
import { createFilmWriters } from "~/server/explainer/director";
import { premiumPlanner } from "~/server/explainer/planner";
import { narrateBeats } from "~/server/explainer/narration";
import {
  readRepositoryForVideo,
  type VideoRepository,
} from "~/server/explainer/repository";
import {
  assembleMp4,
  mixSoundtrack,
  segmentRanges,
} from "~/server/explainer/ffmpeg";
import { renderVideoSegment } from "~/server/explainer/render";
import { scriptWordCount } from "~/server/explainer/script";
import { normalizeShots } from "~/server/explainer/shots";
import { videoVersion } from "~/server/explainer/store";

const ROOT = join(process.cwd(), "experiments", "video-models", "out");

export const VARIANTS = [
  { id: "opus-low", model: "claude-opus-5-5", effort: "low" },
  { id: "sol-low", model: "gpt-6-sol", effort: "low" },
  { id: "sol-medium", model: "gpt-6-sol", effort: "medium" },
  { id: "luna-low", model: "gpt-6-luna", effort: "low" },
  { id: "luna-medium", model: "gpt-6-luna", effort: "medium" },
] as const;

export const REPOS = [
  "fastapi/fastapi",
  "BurntSushi/ripgrep",
  "pmndrs/zustand",
  "excalidraw/excalidraw",
];

type Variant = (typeof VARIANTS)[number];

function limiter(size: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async <T>(run: () => Promise<T>): Promise<T> => {
    if (active >= size) await new Promise<void>((go) => queue.push(go));
    active++;
    try {
      return await run();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

// ElevenLabs Starter (the narrator when this ran; production now voices
// through OpenRouter) allowed four concurrent requests.
const voiceSlot = limiter(3);

async function readRepo(slug: string): Promise<VideoRepository> {
  const path = join(ROOT, "repos", `${slug.replace("/", "__")}.json`);
  try {
    return JSON.parse(await readFile(path, "utf8")) as VideoRepository;
  } catch {
    const [username, repo] = slug.split("/") as [string, string];
    const repository = await readRepositoryForVideo({ username, repo });
    await mkdir(join(ROOT, "repos"), { recursive: true });
    await writeFile(path, JSON.stringify(repository));
    return repository;
  }
}

const storeDir = (variant: string) => join(ROOT, "runs", variant);
const repoDir = (variant: string, owner: string, repo: string) =>
  join(
    storeDir(variant),
    ".video-cache",
    "video",
    "v1",
    owner.toLowerCase(),
    repo.toLowerCase(),
  );

async function generateOne(variant: Variant, repository: VideoRepository) {
  const { owner, repo } = repository.meta;
  const dir = repoDir(variant.id, owner, repo);
  const done = await readFile(join(dir, "artifact.json")).catch(() => null);
  if (done) return;

  const warnings: string[] = [];
  const originalWarn = console.warn;
  const started = Date.now();
  // createFilmWriters reads these synchronously, so parallel variants are safe.
  process.env.VIDEO_PLANNER_MODEL = variant.model;
  process.env.VIDEO_PLANNER_EFFORT = variant.effort;
  const writers = createFilmWriters(repository.prompt, premiumPlanner());
  const log: string[] = [];
  console.warn = (...args: unknown[]) => {
    log.push(args.map(String).join(" "));
    originalWarn(`[${variant.id} ${owner}/${repo}]`, ...args);
  };
  try {
    const script = await writers.direct();
    const planMs = Date.now() - started;
    const designStarted = Date.now();
    let designMs = 0;
    const [designed, narration] = await Promise.all([
      writers.design(script).then((result) => {
        designMs = Date.now() - designStarted;
        return result;
      }),
      voiceSlot(() => narrateBeats(script.beats)),
    ]);
    const normalized = normalizeShots(script, designed, repository.facts);
    warnings.push(...normalized.warnings);
    const artifact: VideoArtifact = {
      version: 2,
      repository: `${owner}/${repo}`.toLowerCase(),
      createdAt: new Date().toISOString(),
      meta: repository.meta,
      plan: normalized.plan,
      timing: narration.timing,
      voices: narration.voices,
      stats: {
        totalMs: Date.now() - started,
        readMs: 0,
        planMs,
        voiceMs: Date.now() - started - planMs,
        planner: "api",
        model: `${variant.model}:${variant.effort}`,
        plannerCostUsd: writers.usage.costUsd,
        inputTokens: writers.usage.inputTokens,
        outputTokens: writers.usage.outputTokens,
        ttsCharacters: narration.characters,
        warnings,
      },
    };
    const version = videoVersion(artifact.createdAt)!;
    await mkdir(join(dir, version), { recursive: true });
    await Promise.all(
      narration.clips.map((clip, index) =>
        writeFile(
          join(dir, version, `beat-${String(index).padStart(2, "0")}.mp3`),
          clip,
        ),
      ),
    );
    await writeFile(
      join(dir, "report.json"),
      JSON.stringify(
        {
          variant,
          repository: artifact.repository,
          planMs,
          designMs,
          totalMs: artifact.stats.totalMs,
          calls: writers.usage.calls,
          costUsd: writers.usage.costUsd,
          inputTokens: writers.usage.inputTokens,
          outputTokens: writers.usage.outputTokens,
          words: scriptWordCount(script),
          beats: script.beats.length,
          scenes: new Set(script.beats.map((beat) => beat.scene)).size,
          designedBeats: designed.size,
          durationS: narration.timing.DURATION,
          warnings,
          log,
          script,
          designed: Object.fromEntries(designed),
        },
        null,
        2,
      ),
    );
    await writeFile(join(dir, "artifact.json"), JSON.stringify(artifact));
    console.info(
      `✓ ${variant.id} ${artifact.repository}: ${Math.round(artifact.stats.totalMs / 1000)}s, $${writers.usage.costUsd?.toFixed(3)}, ${warnings.length} warnings`,
    );
  } catch (error) {
    console.error(`✗ ${variant.id} ${owner}/${repo}:`, error);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "error.txt"),
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  } finally {
    console.warn = originalWarn;
  }
}

async function generate() {
  const only = process.argv[3]?.split(",");
  const variants = VARIANTS.filter((v) => !only || only.includes(v.id));
  for (const slug of REPOS) {
    const repository = await readRepo(slug);
    console.info(`Read ${slug}: ${repository.sourceFileCount} source files`);
    await Promise.all(variants.map((v) => generateOne(v, repository)));
  }
}

/** Blind labels per repository, fixed once so reruns keep them. */
async function blindKey(): Promise<Record<string, Record<string, string>>> {
  const path = join(ROOT, "blind-key.json");
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    const key: Record<string, Record<string, string>> = {};
    for (const slug of REPOS) {
      const letters = VARIANTS.map((_, i) => String.fromCharCode(65 + i));
      letters.sort(() => Math.random() - 0.5);
      key[slug.toLowerCase()] = Object.fromEntries(
        VARIANTS.map((v, i) => [v.id, letters[i]!]),
      );
    }
    await writeFile(path, JSON.stringify(key, null, 2));
    return key;
  }
}

const renderSlot = limiter(3);

async function render() {
  const origin = process.env.STAGE_ORIGIN ?? "http://127.0.0.1:4599";
  const key = await blindKey();
  const home = process.cwd();
  for (const variant of VARIANTS) {
    // The store reads narration from ./.video-cache, so work from the run folder.
    try {
      process.chdir(storeDir(variant.id));
    } catch {
      continue;
    }
    for (const slug of REPOS) {
      const [owner, repo] = slug.toLowerCase().split("/") as [string, string];
      const dir = repoDir(variant.id, owner, repo);
      const artifact = await readFile(join(dir, "artifact.json"), "utf8")
        .then((text) => JSON.parse(text) as VideoArtifact)
        .catch(() => null);
      if (!artifact) continue;
      const label = key[slug.toLowerCase()]![variant.id]!;
      const outDir = join(ROOT, "videos", `${owner}__${repo}`);
      const out = join(outDir, `${label}.mp4`);
      if (await readFile(out).catch(() => null)) continue;
      await mkdir(outDir, { recursive: true });
      const started = Date.now();
      let sfx: Parameters<typeof mixSoundtrack>[0]["sfx"] | null = null;
      const segments = await Promise.all(
        segmentRanges(artifact).map((range) =>
          renderSlot(() =>
            renderVideoSegment({
              artifact,
              format: "landscape",
              origin,
              ...range,
              onReady: (cues) => {
                sfx ??= cues;
              },
            }),
          ),
        ),
      );
      const soundtrack = await mixSoundtrack({
        artifact,
        sfx: sfx ?? [],
        origin,
      });
      await writeFile(out, await assembleMp4({ segments, soundtrack }));
      console.info(
        `▶ ${slug} ${label} (${variant.id}) in ${Math.round((Date.now() - started) / 1000)}s`,
      );
    }
  }
  process.chdir(home);
}

async function summary() {
  const rows: string[] = [];
  for (const variant of VARIANTS) {
    for (const slug of REPOS) {
      const [owner, repo] = slug.toLowerCase().split("/") as [string, string];
      const dir = repoDir(variant.id, owner, repo);
      const report = await readFile(join(dir, "report.json"), "utf8")
        .then((t) => JSON.parse(t))
        .catch(() => null);
      const error = await readFile(join(dir, "error.txt"), "utf8").catch(
        () => null,
      );
      if (!report) {
        rows.push(
          `${variant.id}\t${slug}\tFAILED\t${error?.split("\n")[0] ?? "missing"}`,
        );
        continue;
      }
      rows.push(
        [
          variant.id,
          slug,
          `${Math.round(report.planMs / 1000)}s plan`,
          `${Math.round(report.designMs / 1000)}s design`,
          `${Math.round(report.totalMs / 1000)}s total`,
          `$${report.costUsd?.toFixed(3)}`,
          `${report.words}w`,
          `${report.beats}b/${report.scenes}s`,
          `${report.designedBeats}/${report.beats} designed`,
          `${report.durationS}s film`,
          `${report.warnings.length} warn`,
          `${report.log.length} retries/fails`,
        ].join("\t"),
      );
    }
  }
  console.info(rows.join("\n"));
}

const phase = process.argv[2];
if (phase === "generate") await generate();
else if (phase === "render") await render();
else if (phase === "summary") await summary();
else console.error("Usage: run.ts generate [variants] | render | summary");
