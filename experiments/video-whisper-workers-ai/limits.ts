// How long a take Workers AI accepts: the sample takes joined end to end
// into about 3, 10 and 30 minutes, sent to each service once.
//   bun experiments/video-whisper-workers-ai/limits.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { DATA, HERE, readJson, writeJson, type Sample } from "./lib";
import { PROVIDERS } from "./providers";

const samples = readJson<Sample[]>(join(DATA, "samples.json"));
const out: unknown[] = [];
for (const [minutes, names] of [
  [3, ["turbo", "whisper", "nova-3"]],
  [10, ["turbo", "whisper", "nova-3"]],
  [30, ["turbo", "whisper"]],
] as const) {
  const file = join(DATA, `long-${minutes}.mp3`);
  let seconds = 0;
  let scriptWords = 0;
  const parts: string[] = [];
  for (let i = 0; seconds < minutes * 60; i++) {
    const sample = samples[i % samples.length]!;
    parts.push(sample.mp3);
    seconds += sample.seconds;
    scriptWords += sample.stored.beats.reduce((n, b) => n + b.words.length, 0);
  }
  if (!existsSync(file)) {
    const list = join(DATA, `long-${minutes}.txt`);
    writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
    await $`ffmpeg -loglevel error -y -f concat -safe 0 -i ${list} -c copy ${file}`;
  }
  const mp3 = readFileSync(file);
  for (const name of names) {
    const started = performance.now();
    let result: Record<string, unknown>;
    try {
      const heard = await PROVIDERS[name]!.run(mp3);
      result = {
        ok: true,
        heardWords: heard.words.length,
        lastWordEnd: heard.words.at(-1)?.end ?? null,
      };
    } catch (error) {
      result = { ok: false, error: (error as Error).message.slice(0, 400) };
    }
    const line = {
      service: name,
      minutes: Number((seconds / 60).toFixed(1)),
      megabytes: Number((mp3.length / 1e6).toFixed(1)),
      scriptWords,
      ms: Math.round(performance.now() - started),
      ...result,
    };
    console.log(JSON.stringify(line));
    out.push(line);
  }
}
writeJson(join(HERE, "limits.json"), out);
