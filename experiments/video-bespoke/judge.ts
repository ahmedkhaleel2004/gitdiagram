/**
 * Blind visual judging: for each base film, its variants (same script, same
 * voice) are shown as letter-labelled contact sheets to Claude Opus and GPT-6
 * Sol, which score and rank them.
 *
 *   bun experiments/video-bespoke/judge.ts <name> <variant,variant,...>
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BASES, REPOS, variantDir } from "./design";

const OUT = join(process.cwd(), "experiments", "video-bespoke", "out");

const RUBRIC = `You are judging the visuals of short (~55 s) narrated explainer films about one GitHub repository. Every film below uses the SAME narration; only the pictures differ. Each is labelled by a letter and shown as a contact sheet: one frame near the end of every beat, in order, left to right, top to bottom. The dark bar at the bottom is the caption.

Judge what a viewer on a phone or laptop would feel: does it look bespoke to this project and crafted by a skilled motion designer, or like generic auto-generated slides? Reward: a clear focal point in each frame, large readable elements, real content from the project (its real UI, commands, output, pictures, code), compositions that vary and fit what is said, a sense of one continuous story. Penalize: clutter, tiny text, empty or lopsided frames, overlaps, clipped content, generic boxes standing in for content, repetitive layouts.

Score each film 1–10 on: bespoke (specific to this project), craft (composition, scale, readability), clarity (visuals help a newcomer follow), delight (would you want to share it), overall. Then rank all films best to worst, no ties. Be critical and decisive.

Reply with only JSON: {"films": {"<letter>": {"bespoke": n, "craft": n, "clarity": n, "delight": n, "overall": n, "note": "one sentence"}}, "ranking": ["<letter>", ...]}`;

function parse(text: string) {
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

async function judgeFilm(
  base: string,
  repo: string,
  variants: string[],
  narration: string,
) {
  const letters = variants
    .map((_, i) => String.fromCharCode(65 + i))
    .sort(() => Math.random() - 0.5);
  const key = Object.fromEntries(variants.map((v, i) => [letters[i]!, v]));
  const films = await Promise.all(
    Object.entries(key)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(async ([letter, variant]) => ({
        letter,
        image: (
          await readFile(join(variantDir(variant, base, repo), "sheet.jpg"))
        ).toString("base64"),
      })),
  );
  const intro = `Repository: ${repo}\nNarration (shared by every film): ${narration}`;
  const claude = async () => {
    const content: Anthropic.ContentBlockParam[] = [
      { type: "text", text: intro },
    ];
    for (const f of films) {
      content.push({ type: "text", text: `Film ${f.letter}` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: f.image },
      });
    }
    const message = await new Anthropic().messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      system: RUBRIC,
      messages: [{ role: "user", content }],
    });
    const block = message.content.find((b) => b.type === "text");
    return parse(block && block.type === "text" ? block.text : "{}");
  };
  const gpt = async () => {
    const content: OpenAI.Responses.ResponseInputContent[] = [
      { type: "input_text", text: intro },
    ];
    for (const f of films) {
      content.push({ type: "input_text", text: `Film ${f.letter}` });
      content.push({
        type: "input_image",
        image_url: `data:image/jpeg;base64,${f.image}`,
        detail: "high",
      });
    }
    const response = await new OpenAI().responses.create({
      model: "gpt-6-sol",
      instructions: RUBRIC,
      reasoning: { effort: "medium" },
      input: [{ role: "user", content }],
    });
    return parse(response.output_text);
  };
  const [c, g] = await Promise.all([claude(), gpt()]);
  return { key, claude: c, gpt: g };
}

const [name, list] = process.argv.slice(2) as [string, string];
const variants = list.split(",");
const results: Record<string, unknown> = {};
const tally: Record<string, { overall: number[]; rank: number[] }> = {};
await Promise.all(
  Object.keys(BASES).flatMap((base) =>
    REPOS.map(async (repo) => {
      const report = JSON.parse(
        await readFile(
          join(
            OUT,
            "base",
            base,
            ".video-cache/video/v1",
            ...repo.toLowerCase().split("/"),
            "report.json",
          ),
          "utf8",
        ),
      );
      const narration = report.script.beats
        .map((b: { narration: string }) => b.narration)
        .join(" ");
      const result = await judgeFilm(base, repo, variants, narration);
      results[`${base} ${repo}`] = result;
      for (const judge of [result.claude, result.gpt]) {
        (judge.ranking as string[]).forEach((letter, index) => {
          const variant = result.key[letter]!;
          tally[variant] ??= { overall: [], rank: [] };
          tally[variant].rank.push(index + 1);
          tally[variant].overall.push(judge.films[letter].overall);
        });
      }
      console.info(`judged ${base} ${repo}`);
    }),
  ),
);
await writeFile(
  join(OUT, `judge-${name}.json`),
  JSON.stringify(results, null, 2),
);
const avg = (xs: number[]) =>
  (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);
for (const [variant, t] of Object.entries(tally).sort(
  (a, b) => Number(avg(a[1].rank)) - Number(avg(b[1].rank)),
))
  console.info(
    `${variant.padEnd(10)} overall ${avg(t.overall)}  avg rank ${avg(t.rank)}  firsts ${t.rank.filter((r) => r === 1).length}/${t.rank.length}`,
  );
