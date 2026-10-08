/**
 * Makes films through production's writers, without a voice:
 *   bun --conditions=react-server experiments/video-hillclimb/run.ts read|direct|design [repo,...]
 * SCRIPTS names the script set (the director's prompt changes between sets),
 * VARIANT the designed films. Timing is a stand-in at 2.3 words a second.
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoArtifact, VideoTiming } from "~/features/explainer/types";
import { createFilmWriters, designGroups } from "~/server/explainer/director";
import {
  readRepositoryForVideo,
  type VideoRepository,
} from "~/server/explainer/repository";
import { scriptWordCount, type Script } from "~/server/explainer/script";
import { normalizeShots } from "~/server/explainer/shots";
import { normalizeWord } from "~/server/explainer/text";
import {
  installRecorder,
  sum,
  withScope,
  type CallRecord,
} from "../video-haiku-designer/lib";

const OUT = join(process.cwd(), "experiments/video-hillclimb/out");
export const REPOS = [
  "fastapi/fastapi",
  "BurntSushi/ripgrep",
  "pmndrs/zustand",
  "excalidraw/excalidraw",
  "hashicorp/vault",
  "unjs/defu",
  "langgenius/dify",
  "s-t-e-f-a-n/BillCollector",
];
const SCRIPTS = process.env.SCRIPTS ?? "s1";
const VARIANT = process.env.VARIANT ?? "v1";
const DIRECTOR = { model: "claude-opus-5-5", effort: "low" } as const;
const DESIGNER = {
  model: process.env.DESIGNER ?? "claude-haiku-5-5",
  effort: (process.env.EFFORT ?? "medium") as "low" | "medium" | "high",
};
const BUDGET_USD = Number(process.env.BUDGET ?? 12);
const LEDGER = join(OUT, "ledger.jsonl");
const slugOf = (repo: string) => repo.replace("/", "__").toLowerCase();
const exists = (path: string) =>
  readFile(path).then(
    () => true,
    () => false,
  );
const json = async <T>(path: string) =>
  JSON.parse(await readFile(path, "utf8")) as T;
async function spent() {
  const text = await readFile(LEDGER, "utf8").catch(() => "");
  return sum(
    text
      .split("\n")
      .filter(Boolean)
      .map((l) => (JSON.parse(l) as { costUsd: number }).costUsd),
  );
}
async function charge(what: string, costUsd: number) {
  await mkdir(OUT, { recursive: true });
  await appendFile(
    LEDGER,
    `${JSON.stringify({ what, costUsd, at: new Date().toISOString() })}\n`,
  );
}
const costOf = (calls: CallRecord[]) => sum(calls.map((c) => c.costUsd ?? 0));
const repoFile = (repo: string) => join(OUT, "repos", `${slugOf(repo)}.json`);
const scriptFile = (repo: string) =>
  join(OUT, "scripts", SCRIPTS, `${slugOf(repo)}.json`);

interface SavedRepo extends Omit<VideoRepository, "pictures"> {
  pictures: Array<Omit<VideoRepository["pictures"][number], "bytes">>;
}

async function read(repo: string) {
  if (await exists(repoFile(repo))) return;
  const [username, name] = repo.split("/") as [string, string];
  const repository = await readRepositoryForVideo({ username, repo: name });
  const dir = join(OUT, "images", slugOf(repo));
  await mkdir(dir, { recursive: true });
  await mkdir(join(OUT, "repos"), { recursive: true });
  for (const p of repository.pictures)
    await writeFile(join(dir, `${p.id}.${p.mediaType.split("/")[1]}`), p.bytes);
  const saved: SavedRepo = {
    ...repository,
    pictures: repository.pictures.map(({ bytes: _b, ...rest }) => rest),
  };
  await writeFile(repoFile(repo), JSON.stringify(saved));
  console.info(
    `read ${repo}: ${repository.pictures.length} pictures, ${Math.round(repository.facts.material!.length / 1000)}k chars`,
  );
}

async function direct(repo: string) {
  if (await exists(scriptFile(repo))) return;
  const repository = await json<SavedRepo>(repoFile(repo));
  const store = { calls: [] as CallRecord[], phase: "direct" };
  const started = Date.now();
  const script = await withScope(store, () =>
    createFilmWriters(
      repository.prompt,
      { ...DIRECTOR, designer: DESIGNER },
      { images: repository.pictures },
    ).direct(),
  );
  const ms = Date.now() - started;
  await charge(`direct ${repo}`, costOf(store.calls));
  await mkdir(join(OUT, "scripts", SCRIPTS), { recursive: true });
  await writeFile(
    scriptFile(repo),
    JSON.stringify(
      { script, ms, calls: store.calls, costUsd: costOf(store.calls) },
      null,
      2,
    ),
  );
  console.info(
    `directed ${repo}: ${script.beats.length} beats, ${designGroups(script).length} scenes, ${scriptWordCount(script)} words, ${Math.round(ms / 1000)}s, $${costOf(store.calls).toFixed(3)}, ${store.calls.length} calls`,
  );
}

function stubTiming(script: Script): VideoTiming {
  let t = 0.4;
  const beats = script.beats.map((beat, index) => {
    if (index > 0)
      t += script.beats[index - 1]!.scene !== beat.scene ? 0.5 : 0.2;
    const start = t;
    const words = beat.narration
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => {
        const s = t;
        t += 1 / 2.3;
        return {
          w: normalizeWord(word),
          s: +s.toFixed(3),
          e: +(t - 0.05).toFixed(3),
        };
      });
    return { start: +start.toFixed(3), end: +t.toFixed(3), words };
  });
  return {
    DURATION: Math.ceil((t + 3.6) * 10) / 10,
    SPEECH_END: +t.toFixed(3),
    beats,
  };
}

export async function build(
  repo: string,
  designed: Map<number, Record<string, unknown>>,
  extra: Partial<VideoArtifact["stats"]> = {},
) {
  const repository = await json<SavedRepo>(repoFile(repo));
  const saved = (await json<{ script: Script }>(scriptFile(repo))).script;
  const { plan, warnings } = normalizeShots(saved, designed, repository.facts);
  const shown = new Set(
    plan.beats.flatMap((b) =>
      b.elements.flatMap((e) => (e.kind === "image" ? [String(e.src)] : [])),
    ),
  );
  const pictures = repository.pictures.filter((p) => shown.has(p.id));
  if (pictures.length)
    plan.images = Object.fromEntries(
      pictures.map((p) => [
        p.id,
        `/exp-images/${slugOf(repo)}/${p.id}.${p.mediaType.split("/")[1]}`,
      ]),
    );
  const artifact: VideoArtifact = {
    version: 2,
    repository: repo.toLowerCase(),
    createdAt: new Date().toISOString(),
    meta: repository.meta,
    plan,
    timing: stubTiming(saved),
    voices: [{ start: 0.4 }],
    stats: {
      totalMs: 0,
      readMs: 0,
      planMs: 0,
      voiceMs: 0,
      planner: "api",
      model: `${DIRECTOR.model}+${DESIGNER.model}`,
      plannerCostUsd: null,
      inputTokens: null,
      outputTokens: null,
      ttsCharacters: 0,
      warnings,
      ...extra,
    },
  };
  return artifact;
}

async function design(repo: string) {
  const dir = join(OUT, "films", VARIANT, slugOf(repo));
  if (await exists(join(dir, "report.json"))) return;
  if ((await spent()) > BUDGET_USD)
    throw new Error("Budget reached; stopping.");
  const repository = await json<SavedRepo>(repoFile(repo));
  const savedScript = await json<{ script: Script; costUsd: number }>(
    scriptFile(repo),
  );
  const saved = savedScript.script;
  const store: Parameters<typeof withScope>[0] = {
    calls: [],
    phase: "direct",
    replay: saved,
    raws: [],
  };
  let designed = new Map<number, Record<string, unknown>>();
  let failed: string | undefined;
  let designMs = 0;
  await withScope(store, async () => {
    const writers = createFilmWriters(
      repository.prompt,
      { ...DIRECTOR, designer: DESIGNER },
      { images: repository.pictures },
    );
    const script = await writers.direct();
    if (JSON.stringify(script) !== JSON.stringify(saved))
      throw new Error("The replayed script differs from the saved one.");
    store.replay = undefined;
    store.phase = "design";
    const started = Date.now();
    try {
      designed = await writers.design(script, AbortSignal.timeout(240_000));
    } catch (error) {
      failed = String((error as Error)?.message ?? error);
    }
    designMs = Date.now() - started;
  });
  const calls = store.calls;
  await charge(`design ${VARIANT} ${repo}`, costOf(calls));
  const designCost = costOf(calls);
  const artifact = await build(repo, designed, {
    plannerCostUsd: designCost + savedScript.costUsd,
    totalMs: designMs,
  });
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "raw-shots.json"),
    JSON.stringify([...designed.entries()]),
  );
  await writeFile(join(dir, "raw-calls.json"), JSON.stringify(store.raws));
  await writeFile(join(dir, "artifact.json"), JSON.stringify(artifact));
  const designCalls = calls.filter((c) => c.phase === "design");
  await writeFile(
    join(dir, "report.json"),
    JSON.stringify(
      {
        repo,
        failed,
        designMs,
        designCost,
        scriptCost: savedScript.costUsd,
        calls,
        warnings: artifact.stats.warnings,
      },
      null,
      2,
    ),
  );
  console.info(
    `${failed ? "✗" : "✓"} ${repo}: ${Math.round(designMs / 1000)}s, design $${designCost.toFixed(4)} + script $${savedScript.costUsd.toFixed(3)}, ${designCalls.length} calls/${designGroups(saved).length} scenes, designed ${designed.size}/${saved.beats.length}, out tokens ${sum(designCalls.map((c) => c.output))}, ${artifact.stats.warnings.length} warnings${failed ? ` FAILED ${failed}` : ""}`,
  );
  for (const w of artifact.stats.warnings.slice(0, 6)) console.info(`    ${w}`);
}

/** Re-runs the checker over saved designer replies (after a layout change). */
async function rebuild(repo: string) {
  const dir = join(OUT, "films", VARIANT, slugOf(repo));
  if (!(await exists(join(dir, "raw-shots.json")))) return;
  const designed = new Map(
    await json<Array<[number, Record<string, unknown>]>>(
      join(dir, "raw-shots.json"),
    ),
  );
  const old = await json<VideoArtifact>(join(dir, "artifact.json"));
  const target = process.env.INTO
    ? join(OUT, "films", process.env.INTO, slugOf(repo))
    : dir;
  await mkdir(target, { recursive: true });
  await writeFile(
    join(target, "artifact.json"),
    JSON.stringify(
      await build(repo, designed, {
        plannerCostUsd: old.stats.plannerCostUsd,
        totalMs: old.stats.totalMs,
      }),
    ),
  );
}

async function pool<T>(
  items: T[],
  size: number,
  work: (item: T) => Promise<void>,
) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: size }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift())
        await work(item).catch((error) => console.error("✗", item, error));
    }),
  );
}

if (import.meta.main) {
  installRecorder();
  const [command, list] = process.argv.slice(2) as [string, string?];
  const repos = list?.split(",") ?? REPOS;
  if (command === "read") await pool(repos, 3, read);
  else if (command === "direct") await pool(repos, 3, direct);
  else if (command === "design") await pool(repos, 3, design);
  else if (command === "rebuild") await pool(repos, 1, rebuild);
  else throw new Error("read | direct | design | rebuild");
  console.info(`spent so far: $${(await spent()).toFixed(3)}`);
}
