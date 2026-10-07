// Runs every sample through the named services and keeps each answer.
//   bun experiments/video-whisper-workers-ai/transcribe.ts <provider,...> [run] [limit]
// `run` names a repeat (a second run of the same service measures how much
// a service differs from itself). Answers are cached under out/heard/.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, readJson, writeJson, type Sample } from "./lib";
import { transcribe } from "./providers";

const names = (process.argv[2] ?? "").split(",").filter(Boolean);
const run = process.argv[3] ?? "a";
const limit = Number(process.argv[4] ?? Infinity);
const samples = readJson<Sample[]>(join(DATA, "samples.json")).slice(0, limit);
mkdirSync(join(DATA, "heard"), { recursive: true });

for (const name of names)
  for (const sample of samples) {
    const file = join(DATA, "heard", `${sample.slug}.${name}.${run}.json`);
    if (existsSync(file)) continue;
    try {
      const out = await transcribe(name, readFileSync(sample.mp3));
      writeJson(file, out);
      console.log(
        `${name} ${sample.slug}: ${out.words.length} words in ${out.ms} ms (attempts ${out.attempts})`,
      );
    } catch (error) {
      console.log(`${name} ${sample.slug}: FAILED ${(error as Error).message}`);
    }
  }
