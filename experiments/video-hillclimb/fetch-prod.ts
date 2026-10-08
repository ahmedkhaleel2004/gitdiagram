// Downloads the most recent production films (the public artifact) so the
// audit has a baseline of what visitors are getting today.
//   bun experiments/video-hillclimb/fetch-prod.ts [count]
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUT = join(process.cwd(), "experiments/video-hillclimb/out/prod");
const want = Number(process.argv[2] ?? 24);
const cards: Array<{ owner: string; repo: string; createdAt: string }> = [];
for (let page = 1; cards.length < want && page < 6; page++) {
  const res = await fetch(
    `https://gitdiagram.com/api/video/catalog?page=${page}`,
  );
  const body = (await res.json()) as { cards: typeof cards };
  cards.push(...body.cards);
}
for (const card of cards.slice(0, want)) {
  const res = await fetch(
    `https://gitdiagram.com/api/video?username=${card.owner}&repo=${card.repo}`,
  );
  const body = (await res.json()) as { video?: unknown };
  if (!body.video) continue;
  const dir = join(OUT, `${card.owner}__${card.repo}`.toLowerCase());
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "artifact.json"),
    JSON.stringify(body.video, null, 1),
  );
  console.info(card.createdAt, card.owner, card.repo);
}
