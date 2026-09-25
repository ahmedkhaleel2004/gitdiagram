/**
 * Blind judging: each judge sees one repository's films as letters only (the
 * narration as written and one frame per beat), then scores and ranks them.
 *
 *   bun experiments/video-models/judge.ts
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(process.cwd(), "experiments", "video-models", "out");
type Key = Record<string, Record<string, string>>;

const RUBRIC = `You are judging short (~55 s) narrated explainer films, each explaining one GitHub repository to a smart newcomer. Several films were made for the same repository; they are labelled only by letter. For each film you get its narration script (bracketed tags like [curious] are voice-delivery cues, not spoken) and a contact sheet: one frame captured at the end of every beat, in order, left to right, top to bottom.

A great film: opens on a problem users recognise and lets the project arrive as the answer; follows one thread as a story rather than listing facts; goes top-down (what it is → how the main parts fit → a couple of clever decisions); sounds natural and vivid when spoken; is concrete and specific to this project; ends on a line that lands. Visually: clean, uncluttered, readable compositions with a clear focal element, real content (commands, requests, code) rather than generic boxes, visuals that match what is being said, no overlaps, clipped text or empty frames.

Score each film 1–10 on: story (narrative and hook), clarity (would a newcomer understand what it is and how it works), writing (how it sounds spoken), visuals (composition and craft), sync (visuals match narration), overall. Then rank all films best to worst. Be decisive and critical; do not give ties in the ranking.

Reply with only JSON: {"films": {"<letter>": {"story": n, "clarity": n, "writing": n, "visuals": n, "sync": n, "overall": n, "note": "one sentence"}}, "ranking": ["<letter>", ...]}`;

async function films(repo: string, labels: Record<string, string>) {
  const [owner, name] = repo.split("/") as [string, string];
  const out = [];
  for (const [variant, label] of Object.entries(labels)) {
    const report = JSON.parse(
      await readFile(
        join(
          ROOT,
          "runs",
          variant,
          ".video-cache/video/v1",
          owner,
          name,
          "report.json",
        ),
        "utf8",
      ),
    );
    const script = report.script.beats
      .map(
        (beat: { spoken?: string; narration: string }) =>
          beat.spoken ?? beat.narration,
      )
      .join(" ");
    const sheet = await readFile(
      join(ROOT, "videos", `${owner}__${name}`, `${label}-sheet.jpg`),
    );
    out.push({
      label,
      text: `Film ${label}\nTitle: ${report.script.title}\nNarration: ${script}\nClosing on-screen line: ${report.script.outro}`,
      image: sheet.toString("base64"),
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function parse(text: string) {
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

async function claude(repo: string, list: Awaited<ReturnType<typeof films>>) {
  const client = new Anthropic();
  const content: Anthropic.ContentBlockParam[] = [
    { type: "text", text: `Repository: ${repo}` },
  ];
  for (const film of list) {
    content.push({ type: "text", text: film.text });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: film.image },
    });
  }
  const message = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 8000,
    system: RUBRIC,
    messages: [{ role: "user", content }],
  });
  const text = message.content.find((b) => b.type === "text");
  return parse(text && text.type === "text" ? text.text : "{}");
}

async function gpt(repo: string, list: Awaited<ReturnType<typeof films>>) {
  const client = new OpenAI();
  const content: OpenAI.Responses.ResponseInputContent[] = [
    { type: "input_text", text: `Repository: ${repo}` },
  ];
  for (const film of list) {
    content.push({ type: "input_text", text: film.text });
    content.push({
      type: "input_image",
      image_url: `data:image/jpeg;base64,${film.image}`,
      detail: "high",
    });
  }
  const response = await client.responses.create({
    model: "gpt-6-sol",
    instructions: RUBRIC,
    reasoning: { effort: "medium" },
    input: [{ role: "user", content }],
  });
  return parse(response.output_text);
}

const key = JSON.parse(
  await readFile(join(ROOT, "blind-key.json"), "utf8"),
) as Key;
const results: Record<string, unknown> = {};
await Promise.all(
  Object.entries(key).map(async ([repo, labels]) => {
    const list = await films(repo, labels);
    const [c, g] = await Promise.all([claude(repo, list), gpt(repo, list)]);
    results[repo] = { claude: c, gpt: g };
    console.info(`judged ${repo}`);
  }),
);
await writeFile(
  join(ROOT, "judgements.json"),
  JSON.stringify(results, null, 2),
);
