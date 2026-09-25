/**
 * Blind end-to-end judging: whole films (script and pictures differ), each as
 * its narration plus a contact sheet, labelled by letter.
 *
 *   bun --conditions=react-server experiments/video-bespoke/judge-films.ts <name> <entry,entry,...>
 * An entry is "base:<opus-low|sol-medium>[:<design variant>]" or "film:<config>".
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REPOS, variantDir } from "./design";
import { filmDir } from "./film";

const OUT = join(process.cwd(), "experiments", "video-bespoke", "out");
const RUBRIC = `You are judging short (~55 s) narrated explainer films, each explaining one GitHub repository to a smart newcomer. Several films were made for the same repository; they are labelled only by letter. For each film you get its narration script (bracketed tags like [curious] are voice-delivery cues, not spoken) and a contact sheet: one frame captured at the end of every beat, in order, left to right, top to bottom.

A great film: opens on a problem users recognise and lets the project arrive as the answer; follows one thread as a story rather than listing facts; goes top-down (what it is → how the main parts fit → a couple of clever decisions); sounds natural and vivid when spoken; is concrete and specific to this project; ends on a line that lands. Visually: clean, uncluttered, readable compositions with a clear focal element, real content (commands, requests, code) rather than generic boxes, visuals that match what is being said, no overlaps, clipped text or empty frames.

Score each film 1–10 on: story (narrative and hook), clarity (would a newcomer understand what it is and how it works), writing (how it sounds spoken), visuals (composition and craft), sync (visuals match narration), overall. Then rank all films best to worst. Be decisive and critical; do not give ties in the ranking.

Reply with only JSON: {"films": {"<letter>": {"story": n, "clarity": n, "writing": n, "visuals": n, "sync": n, "overall": n, "note": "one sentence"}}, "ranking": ["<letter>", ...]}`;

function parse(text: string) {
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

async function load(entry: string, repo: string) {
  const [kind, name, design = "base"] = entry.split(":") as [
    string,
    string,
    string?,
  ];
  const dir =
    kind === "film" ? filmDir(name, repo) : variantDir(design, name, repo);
  const reportDir =
    kind === "film"
      ? dir
      : join(
          OUT,
          "base",
          name,
          ".video-cache/video/v1",
          ...repo.toLowerCase().split("/"),
        );
  const report = JSON.parse(
    await readFile(join(reportDir, "report.json"), "utf8"),
  );
  const narration = report.script.beats
    .map((b: { spoken?: string; narration: string }) => b.spoken ?? b.narration)
    .join(" ");
  return {
    text: `Title: ${report.script.title}\nNarration: ${narration}\nClosing on-screen line: ${report.script.outro}`,
    image: (await readFile(join(dir, "sheet.jpg"))).toString("base64"),
  };
}

const [name, list] = process.argv.slice(2) as [string, string];
const entries = list.split(",");
const results: Record<string, unknown> = {};
const tally: Record<
  string,
  { overall: number[]; rank: number[]; story: number[]; visuals: number[] }
> = {};
await Promise.all(
  REPOS.map(async (repo) => {
    const letters = entries
      .map((_, i) => String.fromCharCode(65 + i))
      .sort(() => Math.random() - 0.5);
    const key = Object.fromEntries(entries.map((e, i) => [letters[i]!, e]));
    const films = await Promise.all(
      Object.entries(key)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(async ([letter, entry]) => ({
          letter,
          ...(await load(entry, repo)),
        })),
    );
    const claude = async () => {
      const content: Anthropic.ContentBlockParam[] = [
        { type: "text", text: `Repository: ${repo}` },
      ];
      for (const f of films) {
        content.push({ type: "text", text: `Film ${f.letter}\n${f.text}` });
        content.push({
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: f.image },
        });
      }
      const m = await new Anthropic().messages.create({
        model: "claude-opus-5-5",
        max_tokens: 6000,
        system: RUBRIC,
        messages: [{ role: "user", content }],
      });
      const b = m.content.find((x) => x.type === "text");
      return parse(b && b.type === "text" ? b.text : "{}");
    };
    const gpt = async () => {
      const content: OpenAI.Responses.ResponseInputContent[] = [
        { type: "input_text", text: `Repository: ${repo}` },
      ];
      for (const f of films) {
        content.push({
          type: "input_text",
          text: `Film ${f.letter}\n${f.text}`,
        });
        content.push({
          type: "input_image",
          image_url: `data:image/jpeg;base64,${f.image}`,
          detail: "high",
        });
      }
      const r = await new OpenAI().responses.create({
        model: "gpt-6-sol",
        instructions: RUBRIC,
        reasoning: { effort: "medium" },
        input: [{ role: "user", content }],
      });
      return parse(r.output_text);
    };
    const [c, g] = await Promise.all([claude(), gpt()]);
    results[repo] = { key, claude: c, gpt: g };
    for (const judge of [c, g])
      (judge.ranking as string[]).forEach((letter, index) => {
        const entry = key[letter]!;
        tally[entry] ??= { overall: [], rank: [], story: [], visuals: [] };
        tally[entry].rank.push(index + 1);
        tally[entry].overall.push(judge.films[letter].overall);
        tally[entry].story.push(judge.films[letter].story);
        tally[entry].visuals.push(judge.films[letter].visuals);
      });
    console.info(`judged ${repo}`);
  }),
);
await writeFile(
  join(OUT, `judge-films-${name}.json`),
  JSON.stringify(results, null, 2),
);
const avg = (xs: number[]) =>
  (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);
for (const [entry, t] of Object.entries(tally).sort(
  (a, b) => Number(avg(a[1].rank)) - Number(avg(b[1].rank)),
))
  console.info(
    `${entry.padEnd(24)} overall ${avg(t.overall)}  story ${avg(t.story)}  visuals ${avg(t.visuals)}  avg rank ${avg(t.rank)}  firsts ${t.rank.filter((r) => r === 1).length}/${t.rank.length}`,
  );
