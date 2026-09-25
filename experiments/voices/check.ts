// Transcribes every sample and compares it with the script: word error rate,
// spoken delivery tags, and pace.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import OpenAI from "openai";

const ROOT = join(process.cwd(), "experiments", "voices", "out");
const client = new OpenAI();
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/\[[a-z ]+\]/g, " ")
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

function distance(a: string[], b: string[]): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j]!;
      row[j] = Math.min(
        row[j]! + 1,
        row[j - 1]! + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = temp;
    }
  }
  return row[b.length]!;
}

const results = JSON.parse(
  await readFile(join(ROOT, "results.json"), "utf8"),
) as Array<Record<string, unknown>>;
const TAGS = [
  "excited",
  "curious",
  "impressed",
  "warmly",
  "thoughtful",
  "confident",
  "amused",
  "playfully",
];
await Promise.all(
  results.map(async (result) => {
    const script = await readFile(
      join(ROOT, String(result.script), "script.txt"),
      "utf8",
    );
    const file = join(ROOT, String(result.script), `${result.id}.mp3`);
    const transcript = await client.audio.transcriptions.create({
      model: "gpt-4o-transcribe",
      file: new File([await readFile(file)], "a.mp3", { type: "audio/mpeg" }),
      prompt:
        "FastAPI, Swagger UI, Pydantic, Zustand, useSyncExternalStore, devtools",
    });
    const heard = words(transcript.text);
    const expected = words(script);
    const spokenTags = TAGS.filter(
      (tag) =>
        heard.filter((w) => w === tag).length >
        expected.filter((w) => w === tag).length,
    );
    result.wer = Number(
      (distance(expected, heard) / expected.length).toFixed(3),
    );
    result.spokenTags = spokenTags;
    result.wpm = Math.round(expected.length / (Number(result.seconds) / 60));
    result.transcript = transcript.text;
  }),
);
await writeFile(join(ROOT, "results.json"), JSON.stringify(results, null, 2));
for (const r of results.sort((a, b) =>
  String(a.id).localeCompare(String(b.id)),
))
  console.info(
    `${String(r.script).padEnd(8)} ${String(r.id).padEnd(30)} ${Number(r.seconds).toFixed(1)}s ${r.wpm}wpm WER ${r.wer} tags:${(r.spokenTags as string[]).join(",") || "-"} $${Number(r.costUsd).toFixed(4)}`,
  );
