// Videos published per day, from the public gallery (read-only). A video
// regenerated or never published is not counted, so real voicing runs are a
// little higher than this.
//   bun experiments/video-whisper-workers-ai/volume.ts
import { join } from "node:path";
import { HERE, writeJson } from "./lib";

const SITE = "https://gitdiagram.com";
const days: Record<string, number> = {};
const durations: number[] = [];
let totalPages = 1;
let total = 0;
for (let page = 1; page <= totalPages; page++) {
  const body = (await (
    await fetch(`${SITE}/api/video/catalog?page=${page}`)
  ).json()) as {
    total: number;
    totalPages: number;
    cards: Array<{ createdAt: string; durationSeconds: number }>;
  };
  totalPages = body.totalPages;
  total = body.total;
  for (const card of body.cards) {
    const day = card.createdAt.slice(0, 10);
    days[day] = (days[day] ?? 0) + 1;
    durations.push(card.durationSeconds);
  }
  await Bun.sleep(150);
}
const sorted = Object.entries(days).sort();
for (const [day, count] of sorted) console.log(day, count);
const now = Date.now();
const within = (n: number) =>
  sorted
    .filter(([day]) => now - Date.parse(day) < n * 86_400_000)
    .reduce((sum, [, count]) => sum + count, 0);
durations.sort((a, b) => a - b);
const summary = {
  total,
  counted: durations.length,
  first: sorted[0]?.[0],
  last7Days: within(7),
  last3Days: within(3),
  filmSeconds: {
    min: durations[0],
    median: durations[durations.length >> 1],
    mean: durations.reduce((a, b) => a + b, 0) / durations.length,
    max: durations.at(-1),
  },
  days,
};
console.log(JSON.stringify({ ...summary, days: undefined }));
writeJson(join(HERE, "volume.json"), summary);
