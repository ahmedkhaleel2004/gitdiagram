// Blind listening judges: every sample of one script, shuffled and lettered,
// ranked by an OpenAI audio model and a Google model.
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import OpenAI from "openai";

const ROOT = join(process.cwd(), "experiments", "voices", "out");
const only = process.argv[2]?.split(",");
const results = (
  JSON.parse(await readFile(join(ROOT, "results.json"), "utf8")) as Array<{
    script: string;
    id: string;
  }>
).filter((r) => !only || only.includes(r.id));
const geminiKey = (
  await readFile(join(homedir(), ".config/gitdiagram/gemini-api-key"), "utf8")
).trim();

const RUBRIC = (
  letters: string[],
) => `You are a demanding audio producer choosing the narrator for short explainer videos about software projects. Each clip below is the same ~55-second script read by a different text-to-speech system, labelled ${letters.join(", ")} in the order given. Listen to all of them.

Judge each clip on: naturalness (does it sound like a real person, not a machine), expressiveness (pitch and pace rise and fall with the meaning; questions sound like questions; enthusiasm where the script turns), pacing (breathes at commas and stops, not rushed, not dragging), clarity (every word, technical names pronounced right), and audio quality (no glitches, clipping, robotic artifacts, odd breaths).

Score each 1–10 on overall suitability as the narrator, give one short sentence of reasoning, then rank all clips best to worst without ties. Reply with only JSON: {"clips": {"A": {"score": n, "note": "..."}, ...}, "ranking": ["A", ...]}`;

const parse = (text: string) =>
  JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

async function openaiJudge(clips: Array<{ letter: string; audio: Buffer }>) {
  const client = new OpenAI();
  const content: OpenAI.Chat.ChatCompletionContentPart[] = [
    { type: "text", text: RUBRIC(clips.map((c) => c.letter)) },
  ];
  for (const clip of clips) {
    content.push({ type: "text", text: `Clip ${clip.letter}:` });
    content.push({
      type: "input_audio",
      input_audio: { data: clip.audio.toString("base64"), format: "mp3" },
    });
  }
  const response = await client.chat.completions.create({
    model: "gpt-audio",
    modalities: ["text"],
    messages: [{ role: "user", content }],
  });
  return parse(response.choices[0]!.message.content ?? "{}");
}

async function geminiJudge(clips: Array<{ letter: string; audio: Buffer }>) {
  const parts: Array<Record<string, unknown>> = [
    { text: RUBRIC(clips.map((c) => c.letter)) },
  ];
  for (const clip of clips) {
    parts.push({ text: `Clip ${clip.letter}:` });
    parts.push({
      inlineData: {
        mimeType: "audio/mp3",
        data: clip.audio.toString("base64"),
      },
    });
  }
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }] }),
    },
  );
  const body = (await response.json()) as {
    candidates?: Array<{ content: { parts: Array<{ text?: string }> } }>;
  };
  return parse(
    body.candidates?.[0]?.content.parts.map((p) => p.text ?? "").join("") ??
      "{}",
  );
}

const verdicts: Record<string, unknown> = {};
for (const script of [...new Set(results.map((r) => r.script))]) {
  const ids = results
    .filter((r) => r.script === script)
    .map((r) => r.id)
    .sort(() => Math.random() - 0.5);
  const clips = await Promise.all(
    ids.map(async (id, i) => ({
      letter: String.fromCharCode(65 + i),
      id,
      audio: await readFile(join(ROOT, script, `${id}.mp3`)),
    })),
  );
  const key = Object.fromEntries(clips.map((c) => [c.letter, c.id]));
  const [openai, gemini] = await Promise.all([
    openaiJudge(clips),
    geminiJudge(clips),
  ]);
  verdicts[script] = { key, openai, gemini };
  for (const [name, verdict] of Object.entries({ openai, gemini }) as Array<
    [
      string,
      {
        ranking: string[];
        clips: Record<string, { score: number; note: string }>;
      },
    ]
  >) {
    console.info(`== ${script} · ${name} judge`);
    for (const letter of verdict.ranking)
      console.info(
        `  ${key[letter]?.padEnd(30)} ${verdict.clips[letter]?.score}  ${verdict.clips[letter]?.note}`,
      );
  }
}
await writeFile(
  join(ROOT, only ? "judgements-final.json" : "judgements.json"),
  JSON.stringify(verdicts, null, 2),
);
