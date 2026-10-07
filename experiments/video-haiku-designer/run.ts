/**
 * Haiku 5.5 as scene designer: read each repository once, direct once with
 * Opus 5.5 (low), then hand the identical script to each designer setup.
 *
 *   bun --conditions=react-server experiments/video-haiku-designer/run.ts read|direct|design|sheets [repo,...]
 *
 * `design` goes through production's createFilmWriters: the director's call
 * is answered from the saved script (so Sol's cache prewarm still runs, as in
 * production), the designers are real.
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
  DIRECTOR,
  OUT,
  REPOS,
  RUNS,
  SETUPS,
  SETUP_NAMES,
  installRecorder,
  runDir,
  slugOf,
  sum,
  withScope,
  type CallRecord,
  type SetupName,
} from "./lib";

const BUDGET_USD = 13.5; // stop short of the $15 limit
const LEDGER = join(OUT, "ledger.jsonl");
const exists = (path: string) =>
  readFile(path).then(
    () => true,
    () => false,
  );
const json = async <T>(path: string) =>
  JSON.parse(await readFile(path, "utf8")) as T;

export async function spent() {
  const text = await readFile(LEDGER, "utf8").catch(() => "");
  return sum(
    text
      .split("\n")
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as { costUsd: number }).costUsd),
  );
}
export async function charge(what: string, costUsd: number) {
  await mkdir(OUT, { recursive: true });
  await appendFile(
    LEDGER,
    `${JSON.stringify({ what, costUsd, at: new Date().toISOString() })}\n`,
  );
}
const costOf = (calls: CallRecord[]) => sum(calls.map((c) => c.costUsd ?? 0));

const repoFile = (repo: string) => join(OUT, "repos", `${slugOf(repo)}.json`);
const scriptFile = (repo: string) =>
  join(OUT, "scripts", `${slugOf(repo)}.json`);

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
    pictures: repository.pictures.map(({ bytes: _bytes, ...rest }) => rest),
  };
  await writeFile(repoFile(repo), JSON.stringify(saved));
  console.info(
    `read ${repo}: ${repository.facts.paths.length} paths, ${repository.sourceFileCount} source files, ${repository.pictures.length} pictures, context ${Math.round(repository.facts.material!.length / 1000)}k chars`,
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
      // A Claude designer: no OpenAI prewarm, and the director writes no cache.
      { ...DIRECTOR, designer: SETUPS["haiku-low"] },
      { images: repository.pictures },
    ).direct(),
  );
  const ms = Date.now() - started;
  await charge(`direct ${repo}`, costOf(store.calls));
  await mkdir(join(OUT, "scripts"), { recursive: true });
  await writeFile(
    scriptFile(repo),
    JSON.stringify(
      { script, ms, calls: store.calls, costUsd: costOf(store.calls) },
      null,
      2,
    ),
  );
  console.info(
    `directed ${repo}: ${script.beats.length} beats, ${designGroups(script).length} scenes, ${scriptWordCount(script)} words, ${Math.round(ms / 1000)}s, $${costOf(store.calls).toFixed(3)}, prompt ${store.calls[0]?.promptTokens} tokens`,
  );
}

/** Timing without a voice: 2.3 words a second, a short breath between beats. */
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

async function design(repo: string, setup: SetupName, run: number) {
  const dir = runDir(repo, setup, run);
  if (await exists(join(dir, "report.json"))) return;
  if ((await spent()) > BUDGET_USD)
    throw new Error("Budget reached; stopping.");
  const repository = await json<SavedRepo>(repoFile(repo));
  const saved = (await json<{ script: Script }>(scriptFile(repo))).script;
  const store: Parameters<typeof withScope>[0] = {
    calls: [],
    phase: "direct",
    replay: saved,
    raws: [],
  };
  const report: Record<string, unknown> = {
    repo,
    setup,
    run,
    ...SETUPS[setup],
  };
  let designed = new Map<number, Record<string, unknown>>();
  let pictureIds: string[] = [];
  await withScope(store, async () => {
    const writers = createFilmWriters(
      repository.prompt,
      { ...DIRECTOR, designer: SETUPS[setup] },
      { images: repository.pictures },
    );
    const prewarmStarted = Date.now();
    const script = await writers.direct();
    report.prewarmMs = Date.now() - prewarmStarted;
    if (JSON.stringify(script) !== JSON.stringify(saved))
      throw new Error("The replayed script differs from the saved one.");
    store.replay = undefined;
    store.phase = "design";
    const started = Date.now();
    try {
      // Production's whole run has a 240 s deadline; designing alone gets it here.
      designed = await writers.design(script, AbortSignal.timeout(240_000));
    } catch (error) {
      report.failed = String((error as Error)?.message ?? error);
    }
    report.designMs = Date.now() - started;
    pictureIds = writers.pictureIds;
  });
  const calls = store.calls;
  await charge(`design ${repo} ${setup} r${run}`, costOf(calls));
  // Haiku sometimes sends `shots` as a JSON string instead of an array, which
  // director.ts reads as "no shots" (no error, so no retry). `repaired` is
  // what a one-line parse in director.ts would have kept.
  const repaired = new Map(designed);
  let stringScenes = 0;
  let brokenStringScenes = 0;
  let lenientStringScenes = 0;
  for (const raw of (store.raws ?? []) as Array<Record<string, any>>) {
    const input =
      raw.content?.find((b: any) => b.type === "tool_use")?.input ??
      (() => {
        const call = raw.output?.find((i: any) => i.type === "function_call");
        try {
          return call ? JSON.parse(call.arguments) : undefined;
        } catch {
          return undefined;
        }
      })();
    if (typeof input?.shots !== "string") continue;
    stringScenes++;
    const assigned = (
      /Design exactly the beats ([\d, ]+) and/.exec(raw.task ?? "")?.[1] ?? ""
    )
      .split(",")
      .map((n) => Number(n.trim()));
    // The string is often the array followed by a stray "}", so a strict
    // parse fails; the lenient one stops at the array's last bracket.
    let shots: Array<Record<string, unknown>> | null = null;
    try {
      shots = JSON.parse(input.shots);
    } catch {
      try {
        shots = JSON.parse(
          input.shots.slice(0, input.shots.lastIndexOf("]") + 1),
        );
        lenientStringScenes++;
      } catch {
        brokenStringScenes++;
      }
    }
    if (Array.isArray(shots))
      for (const shot of shots) {
        const beat = Number(shot?.beat);
        if (assigned.includes(beat) && !repaired.has(beat))
          repaired.set(beat, shot);
      }
  }
  const facts = {
    ...repository.facts,
    images: repository.facts.images?.filter((id) => pictureIds.includes(id)),
  };
  const build = (shots: typeof designed) => {
    const { plan, warnings } = normalizeShots(saved, shots, facts);
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
        totalMs: Number(report.designMs),
        readMs: 0,
        planMs: 0,
        voiceMs: Number(report.designMs),
        planner: "api",
        model: `${DIRECTOR.model}+${SETUPS[setup].model}`,
        plannerCostUsd: costOf(calls),
        inputTokens: null,
        outputTokens: null,
        ttsCharacters: 0,
        warnings,
      },
    };
    return { artifact, warnings };
  };
  // As production's code reads the replies today, and with the parse fix.
  const asIs = build(designed);
  const fixed = build(repaired);
  const { artifact, warnings } = fixed;
  const scenes = designGroups(saved).length;
  const designCalls = calls.filter((c) => c.phase === "design");
  Object.assign(report, {
    scenes,
    beats: saved.beats.length,
    beatsDesigned: repaired.size,
    beatsDesignedAsIs: designed.size,
    stringScenes,
    lenientStringScenes,
    brokenStringScenes,
    // Production stores no film with more than a third of its beats undesigned.
    asIsFilmFails:
      Boolean(report.failed) ||
      saved.beats.length - designed.size > saved.beats.length / 3,
    warningsAsIs: asIs.warnings,
    costUsd: costOf(calls),
    calls,
    // Calls beyond one per scene are retries or a second model stepping in.
    extraCalls: designCalls.length - scenes,
    otherModelCalls: designCalls.filter((c) => c.model !== SETUPS[setup].model)
      .length,
    unusable: designCalls.filter(
      (c) =>
        c.error || !c.tool || (c.stop !== "tool_use" && c.stop !== "completed"),
    ).length,
    warnings,
  });
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "raw-calls.json"), JSON.stringify(store.raws));
  await writeFile(
    join(dir, "raw-shots.json"),
    JSON.stringify([...designed.entries()]),
  );
  await writeFile(join(dir, "artifact.json"), JSON.stringify(artifact));
  await writeFile(
    join(dir, "artifact-as-is.json"),
    JSON.stringify(asIs.artifact),
  );
  await writeFile(join(dir, "report.json"), JSON.stringify(report, null, 2));
  console.info(
    `${report.failed ? "✗" : "✓"} ${repo} ${setup} r${run}: ${Math.round(Number(report.designMs) / 1000)}s, $${costOf(calls).toFixed(4)}, ${designCalls.length} calls/${scenes} scenes, ${warnings.length} warnings, ${stringScenes} string scenes, as-is ${designed.size}/${saved.beats.length} beats, max prompt ${Math.max(0, ...designCalls.map((c) => c.promptTokens))}${report.failed ? ` FAILED ${String(report.failed)}` : ""}`,
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
  else if (command === "design") {
    const runs = process.env.RUNS?.split(",").map(Number) ?? RUNS;
    const setups = (process.env.SETUPS?.split(",") as SetupName[]) ?? [
      "haiku-low",
      "sol-medium",
      "haiku-medium",
      "haiku-high",
    ];
    // Two repositories at a time; one film at a time within a repository.
    await pool(repos, 2, async (repo) => {
      for (const run of runs)
        for (const setup of setups) await design(repo, setup, run);
    });
  } else if (command === "sheets") {
    const { beatEnds, browser, grab } = await import("../video-bespoke/frames");
    for (const repo of repos)
      for (const setup of SETUP_NAMES)
        for (const run of RUNS) {
          const dir = runDir(repo, setup, run);
          if (!(await exists(join(dir, "artifact.json")))) continue;
          if (await exists(join(dir, "sheet.jpg"))) continue;
          const artifact = await json<VideoArtifact>(
            join(dir, "artifact.json"),
          );
          await grab(artifact, beatEnds(artifact), join(dir, "sheet")).catch(
            (error) => console.error(`✗ sheet ${dir}`, error),
          );
          console.info(`sheet ${repo} ${setup} r${run}`);
        }
    await (await browser()).close();
  } else throw new Error("read | direct | design | sheets");
  console.info(`spent so far: $${(await spent()).toFixed(3)}`);
}
