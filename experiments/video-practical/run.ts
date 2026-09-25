/**
 * Practical-first script experiment (2026-09-25): the same repositories,
 * scripted by the production director with the previous prompt and with the
 * practical-first prompt, to compare the narration before shipping it.
 *
 *   bun --conditions=react-server experiments/video-practical/run.ts
 *
 * Needs ANTHROPIC_API_KEY and GitHub credentials. Output lands in
 * experiments/video-practical/out (ignored by git).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createFilmWriters } from "~/server/explainer/director";
import { premiumPlanner } from "~/server/explainer/planner";
import { readRepositoryForVideo } from "~/server/explainer/repository";
import { scriptWordCount } from "~/server/explainer/script";
import { SHOT_SYSTEM } from "~/server/explainer/shot-prompt";

const ROOT = join(process.cwd(), "experiments", "video-practical");
const OUT = join(ROOT, "out");

const REPOS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "andronedev/openportal",
      "tldraw/tldraw",
      "fastapi/fastapi",
      "BurntSushi/ripgrep",
    ];

// The previous prompt, saved from the commit before the change.
const previous = (
  await readFile(join(ROOT, "previous-prompt.txt"), "utf8")
).trim();
const VARIANTS = [
  { id: "previous", system: previous },
  { id: "practical", system: SHOT_SYSTEM },
];

await mkdir(OUT, { recursive: true });
const report: string[] = [];
for (const slug of REPOS) {
  const [username, repo] = slug.split("/") as [string, string];
  const repository = await readRepositoryForVideo({ username, repo });
  const results = await Promise.all(
    VARIANTS.map(async (variant) => {
      const writers = createFilmWriters(repository.prompt, premiumPlanner(), {
        images: repository.pictures,
        system: variant.system,
      });
      const script = await writers.direct();
      await writeFile(
        join(OUT, `${username}__${repo}.${variant.id}.json`),
        JSON.stringify(script, null, 2),
      );
      const scenes = [...new Set(script.beats.map((beat) => beat.scene))];
      return [
        `### ${variant.id} (${scriptWordCount(script)} words, ${script.beats.length} beats, ${scenes.length} scenes, $${writers.usage.costUsd?.toFixed(2)})`,
        "",
        script.beats.map((beat) => beat.narration).join(" "),
        "",
        `Outro: ${script.outro}`,
        "",
      ].join("\n");
    }),
  );
  report.push(`## ${slug}`, "", ...results);
  console.log(`done ${slug}`);
}
await writeFile(join(OUT, "report.md"), report.join("\n"));
console.log(report.join("\n"));
