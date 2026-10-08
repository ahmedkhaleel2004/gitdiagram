// A blind look at old against new for the repositories both sets hold:
//   bun experiments/video-hillclimb/judge.ts
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const OUT = join(process.cwd(), "experiments/video-hillclimb/out");
const PAIRS = ["hashicorp__vault", "langgenius__dify", "unjs__defu"];
const client = new Anthropic();
const sheets = async (dir: string) =>
  Promise.all(
    (await readdir(dir))
      .filter((name) => /^sheet-\d+\.jpg$/.test(name))
      .sort()
      .slice(0, 3)
      .map(async (name) => ({
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: "image/jpeg" as const,
          data: (await readFile(join(dir, name))).toString("base64"),
        },
      })),
  );
for (const [i, slug] of PAIRS.entries()) {
  const old = await sheets(join(OUT, "prod", slug));
  const fresh = await sheets(
    join(OUT, "films", process.env.VARIANT ?? "v2c", slug),
  );
  const newIsA = i % 2 === 0;
  const [a, b] = newIsA ? [fresh, old] : [old, fresh];
  const message = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 700,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Two explainer films about the same GitHub repository, as contact sheets (six frames a sheet, in order, the first eighteen beats of each). Judge only how they look: is each frame clean (nothing overlapping, no stray or tangled lines, no cut-off text), well composed and readable, and does the film look designed. Film A:",
          },
          ...a,
          { type: "text", text: "Film B:" },
          ...b,
          {
            type: "text",
            text: 'Reply with JSON only: {"a": score 1-10, "b": score 1-10, "better": "A" or "B", "why": one sentence, "worst_frame_of_winner": one sentence}.',
          },
        ],
      },
    ],
  });
  const text =
    message.content.find((block) => block.type === "text")?.text ?? "";
  console.info(slug, `new is ${newIsA ? "A" : "B"}`, text.replace(/\s+/g, " "));
}
