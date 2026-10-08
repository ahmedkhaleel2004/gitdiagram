// Voices a saved script with production's narrator, to time a 90-second take:
//   bun --conditions=react-server experiments/video-hillclimb/voice.ts owner/repo
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { narrateBeats } from "~/server/explainer/narration";
import type { Script } from "~/server/explainer/script";

const OUT = join(process.cwd(), "experiments/video-hillclimb/out");
const repo = process.argv[2]!;
const slug = repo.replace("/", "__").toLowerCase();
const { script } = JSON.parse(
  await readFile(
    join(OUT, "scripts", process.env.SCRIPTS ?? "s1", `${slug}.json`),
    "utf8",
  ),
) as { script: Script };
const started = Date.now();
const narration = await narrateBeats(
  script.beats,
  AbortSignal.timeout(200_000),
);
const dir = join(OUT, "voice", slug);
await mkdir(dir, { recursive: true });
await writeFile(join(dir, "timing.json"), JSON.stringify(narration.timing));
for (const [i, clip] of narration.clips.entries())
  await writeFile(join(dir, `take-${i}.mp3`), clip);
console.info(
  `${repo}: voiced in ${((Date.now() - started) / 1000).toFixed(1)}s, film ${narration.timing.DURATION}s, speech ends ${narration.timing.SPEECH_END.toFixed(1)}s, $${narration.costUsd.toFixed(4)}, ${narration.characters} chars`,
);
