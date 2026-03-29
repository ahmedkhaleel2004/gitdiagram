import { config } from "dotenv";

config({ path: ".env" });

const { backfillBrowseIndex } = (await import(
  new URL("../src/server/storage/browse-diagrams.ts", import.meta.url).href
));

const startedAt = Date.now();
const entries = await backfillBrowseIndex();
const elapsedMs = Date.now() - startedAt;

console.log(
  `Wrote ${entries.length.toLocaleString()} browse index entries to public/v1/_meta/browse-index.json`,
);
console.log(`Elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);
