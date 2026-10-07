// Picks real published videos of varied length and downloads each one's
// narration take and artifact from gitdiagram.com (public, read-only).
//   bun experiments/video-whisper-workers-ai/fetch-samples.ts [count]
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { DATA, writeJson, type Sample } from "./lib";

const SITE = "https://gitdiagram.com";
const count = Number(process.argv[2] ?? 12);

interface Card {
  owner: string;
  repo: string;
  durationSeconds: number;
  createdAt: string;
}
const cards: Card[] = [];
// Pages spread over the whole gallery (24 a page), so samples span dates.
const first = (await (await fetch(`${SITE}/api/video/catalog`)).json()) as {
  totalPages: number;
  total: number;
  cards: Card[];
};
cards.push(...first.cards);
const pages = [3, 8, 14, 20, 27, 34, 41, 48].filter(
  (p) => p <= first.totalPages,
);
for (const page of pages) {
  const body = (await (
    await fetch(`${SITE}/api/video/catalog?page=${page}`)
  ).json()) as { cards: Card[] };
  cards.push(...body.cards);
}
console.log(`gallery: ${first.total} videos; looked at ${cards.length}`);
const durations = cards.map((c) => c.durationSeconds).sort((a, b) => a - b);
console.log(
  `durations of those: min ${durations[0]} median ${durations[durations.length >> 1]} max ${durations.at(-1)}`,
);
writeJson(join(DATA, "gallery-durations.json"), durations);

// Evenly spaced through the cards sorted by length: shortest, longest and
// the range between.
const byLength = [...cards].sort(
  (a, b) => a.durationSeconds - b.durationSeconds,
);
const wanted: Card[] = [];
const tried = new Set<number>();
const samples: Sample[] = [];
for (let k = 0; samples.length < count && k < count * 3; k++) {
  const slot = k < count ? k : k - count;
  let index = Math.round((slot * (byLength.length - 1)) / (count - 1));
  while (tried.has(index)) index = (index + 1) % byLength.length;
  tried.add(index);
  const card = byLength[index]!;
  wanted.push(card);
  const response = await fetch(
    `${SITE}/api/video?username=${card.owner}&repo=${card.repo}`,
  );
  if (!response.ok) continue;
  const { video } = (await response.json()) as { video?: any };
  // Only the current pipeline: one take for the whole film, read by Charon.
  if (
    !video ||
    video.voices?.length !== 1 ||
    !String(video.stats?.voice ?? "").includes("Charon")
  ) {
    console.log(`skip ${card.owner}/${card.repo} (older pipeline)`);
    continue;
  }
  const slug = `${card.owner}__${card.repo}`.toLowerCase();
  const mp3 = join(DATA, `${slug}.mp3`);
  if (!existsSync(mp3)) {
    const audio = await fetch(
      `${SITE}/api/video/audio?username=${card.owner}&repo=${card.repo}&beat=0&v=${encodeURIComponent(video.createdAt)}`,
    );
    if (!audio.ok) {
      console.log(`skip ${slug}: audio ${audio.status}`);
      continue;
    }
    writeFileSync(mp3, Buffer.from(await audio.arrayBuffer()));
  }
  const seconds = Number(
    (
      await $`ffprobe -v error -show_entries format=duration -of csv=p=0 ${mp3}`.text()
    ).trim(),
  );
  samples.push({
    owner: card.owner,
    repo: card.repo,
    slug,
    createdAt: video.createdAt,
    mp3,
    seconds,
    beats: video.plan.beats.map((beat: any) => ({
      narration: beat.narration,
      scene: beat.scene,
    })),
    stored: video.timing,
  });
  console.log(
    `${slug}: ${seconds.toFixed(1)} s, ${video.plan.beats.length} beats, ${(Bun.file(mp3).size / 1024).toFixed(0)} KB`,
  );
}
writeJson(join(DATA, "samples.json"), samples);
