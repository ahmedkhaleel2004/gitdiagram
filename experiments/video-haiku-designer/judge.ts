/**
 * Blind design judging. For each repository and each run, the four films
 * (same script, different designer) are shown by letter only, in random
 * order, to Claude Opus 5.5 and GPT-6.1 Sol. Each film is its contact sheets
 * (one frame at the end of every beat, six beats a picture).
 *
 *   bun --conditions=react-server experiments/video-haiku-designer/judge.ts
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Script } from "~/server/explainer/script";
import {
  OUT,
  REPOS,
  RUNS,
  SETUP_NAMES,
  installRecorder,
  runDir,
  slugOf,
  sum,
  withScope,
  type CallRecord,
} from "./lib";
import { charge, spent } from "./run";

// SETTLED=1 judges the second look (see sheets.ts), with new random letters.
const SETTLED = process.env.SETTLED === "1";
const PREFIX = SETTLED ? "settled" : "judge";

const RUBRIC = `You are judging the VISUAL DESIGN of short narrated explainer films about one GitHub repository. Every film below was made from the SAME script: the same narration and the same per-beat design brief from the director. Only the scene designer differs. Films are labelled by letter only. Each film is shown as contact sheets: one frame captured ${SETTLED ? "just after" : "near the end of"} every beat, in beat order, left to right, top to bottom, six beats per picture. The dark bar at the bottom of a frame is the caption (the narration), identical across films; ignore it except where a design collides with it.

Judge only the design. Score each film 1-10 on:
- layout: clarity of composition; a clear focal point, readable sizes, sensible use of the frame.
- clean: freedom from overlaps, collisions, crowding, clipped or cut-off content, tiny unreadable type, and empty or near-empty frames (10 = none of these).
- fidelity: does each frame show what its brief asked for, with content that is concrete and plausible for this real project (real-looking commands, code, file names) rather than generic or wrong.
- variety: visual variety across the film; not the same layout repeated.
- overall: the film you would ship.
Then rank all films best to worst, no ties. Be critical and decisive; use the whole scale.

Reply with only JSON: {"films": {"<letter>": {"layout": n, "clean": n, "fidelity": n, "variety": n, "overall": n, "note": "one sentence naming the main strength or flaw"}}, "ranking": ["<letter>", ...]}`;

const BUDGET_USD = 14.2;
const parse = (text: string) =>
  JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

async function sheets(dir: string) {
  const names = (await readdir(dir))
    .filter((n) => new RegExp(`^${PREFIX}-\\d+\\.jpg$`).test(n))
    .sort();
  return Promise.all(
    names.map(async (n) => (await readFile(join(dir, n))).toString("base64")),
  );
}

installRecorder();
const file = join(OUT, SETTLED ? "judge-settled.json" : "judge.json");
const results: Record<string, any> = JSON.parse(
  await readFile(file, "utf8").catch(() => "{}"),
);

for (const repo of REPOS)
  for (const run of RUNS) {
    const id = `${repo}#r${run}`;
    if (results[id]?.claude && results[id]?.gpt) continue;
    if ((await spent()) > BUDGET_USD)
      throw new Error("Budget reached; stopping.");
    const entries = [];
    for (const setup of SETUP_NAMES) {
      const images = await sheets(runDir(repo, setup, run)).catch(() => []);
      if (images.length) entries.push({ setup, images });
    }
    if (entries.length < 2) continue;
    const letters = entries
      .map((_, i) => String.fromCharCode(65 + i))
      .sort(() => Math.random() - 0.5);
    const key: Record<string, string> =
      results[id]?.key ??
      Object.fromEntries(entries.map((e, i) => [letters[i]!, e.setup]));
    const films = Object.entries(key)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([letter, setup]) => ({
        letter,
        images: entries.find((e) => e.setup === setup)!.images,
      }));
    const script = (
      JSON.parse(
        await readFile(join(OUT, "scripts", `${slugOf(repo)}.json`), "utf8"),
      ) as { script: Script }
    ).script;
    const intro = `Repository: ${repo}\nScript shared by every film (beat number, scene, narration, then the director's design brief):\n${script.beats
      .map((b, i) => `${i}. [${b.scene}] "${b.narration}" — brief: ${b.brief}`)
      .join("\n")}`;
    const store = { calls: [] as CallRecord[], phase: "judge" };
    const claude = async () => {
      const content: Anthropic.ContentBlockParam[] = [
        { type: "text", text: intro },
      ];
      for (const f of films) {
        content.push({ type: "text", text: `Film ${f.letter}` });
        for (const data of f.images)
          content.push({
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data },
          });
      }
      const m = await new Anthropic().messages
        .stream({
          model: "claude-opus-5-5",
          max_tokens: 6000,
          system: RUBRIC,
          messages: [{ role: "user", content }],
        })
        .finalMessage();
      const b = m.content.find((x) => x.type === "text");
      return parse(b && b.type === "text" ? b.text : "{}");
    };
    const gpt = async () => {
      const content: OpenAI.Responses.ResponseInputContent[] = [
        { type: "input_text", text: intro },
      ];
      for (const f of films) {
        content.push({ type: "input_text", text: `Film ${f.letter}` });
        for (const data of f.images)
          content.push({
            type: "input_image",
            image_url: `data:image/jpeg;base64,${data}`,
            detail: "high",
          });
      }
      const r = await new OpenAI().responses.create({
        model: "gpt-6.1-sol",
        instructions: RUBRIC,
        reasoning: { effort: "medium" },
        input: [{ role: "user", content }],
      });
      return parse(r.output_text);
    };
    const [c, g] = await withScope(store, () =>
      Promise.all([
        results[id]?.claude ??
          claude().catch((e) => (console.error("claude judge", id, e), null)),
        results[id]?.gpt ??
          gpt().catch((e) => (console.error("gpt judge", id, e), null)),
      ]),
    );
    const cost = sum(store.calls.map((x) => x.costUsd ?? 0));
    await charge(`judge${SETTLED ? "-settled" : ""} ${id}`, cost);
    results[id] = {
      key,
      claude: c,
      gpt: g,
      costUsd: (results[id]?.costUsd ?? 0) + cost,
    };
    await writeFile(file, JSON.stringify(results, null, 2));
    console.info(
      `judged ${id} $${cost.toFixed(3)} ${JSON.stringify(key)} claude ${c?.ranking} gpt ${g?.ranking}`,
    );
  }
console.info(`spent so far: $${(await spent()).toFixed(3)}`);
