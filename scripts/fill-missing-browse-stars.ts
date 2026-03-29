import { config } from "dotenv";

config({ path: ".env" });

const { fillMissingBrowseIndexStars } = (await import(
  new URL("../src/server/storage/browse-diagrams.ts", import.meta.url).href
));

const startedAt = Date.now();
const entries = await fillMissingBrowseIndexStars();
const missingStars = entries.filter(
  (entry: { stargazerCount: number | null }) => entry.stargazerCount === null,
).length;
const elapsedMs = Date.now() - startedAt;

console.log(
  `Updated browse index with ${entries.length.toLocaleString()} entries; ${missingStars.toLocaleString()} still missing stars.`,
);
console.log(`Elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);
