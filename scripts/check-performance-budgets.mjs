import { readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";

const routeBudgets = [
  {
    name: "home",
    route: "/",
    maxGzipBytes: 210_000,
  },
  {
    name: "browse",
    route: "/browse",
    maxGzipBytes: 195_000,
  },
  {
    name: "repo",
    route: "/[username]/[repo]",
    maxGzipBytes: 240_000,
  },
  {
    name: "sponsor",
    route: "/sponsor",
    maxGzipBytes: 190_000,
  },
];

const MAX_SINGLE_CHUNK_GZIP_BYTES = 450_000;
const MAX_FAVICON_BYTES = 20_000;

function gzipSize(file) {
  return gzipSync(readFileSync(file), { level: 9 }).length;
}

const failures = [];
const results = [];
const routeBundleStats = JSON.parse(
  readFileSync(".next/diagnostics/route-bundle-stats.json", "utf8"),
);

for (const route of routeBudgets) {
  const stats = routeBundleStats.find((entry) => entry.route === route.route);
  if (!stats) {
    failures.push(`Missing route bundle stats for ${route.route}.`);
    continue;
  }
  const chunks = [...new Set(stats.firstLoadChunkPaths ?? [])];
  const gzipBytes = chunks.reduce((total, chunk) => total + gzipSize(chunk), 0);
  results.push({
    name: route.name,
    chunks: chunks.length,
    gzipBytes,
    uncompressedBytes: stats.firstLoadUncompressedJsBytes,
  });
  if (gzipBytes > route.maxGzipBytes) {
    failures.push(
      `${route.name} client JS is ${gzipBytes} gzip bytes (budget ${route.maxGzipBytes}).`,
    );
  }
}

const allStaticChunks = readdirSync(".next/static/chunks", {
  recursive: true,
  withFileTypes: true,
})
  .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
  .map((entry) => `static/chunks/${entry.name}`);
const largestChunk = allStaticChunks
  .map((chunk) => ({ chunk, gzipBytes: gzipSize(`.next/${chunk}`) }))
  .sort((left, right) => right.gzipBytes - left.gzipBytes)[0];

if (largestChunk?.gzipBytes > MAX_SINGLE_CHUNK_GZIP_BYTES) {
  failures.push(
    `${largestChunk.chunk} is ${largestChunk.gzipBytes} gzip bytes (single-chunk budget ${MAX_SINGLE_CHUNK_GZIP_BYTES}).`,
  );
}

const faviconBytes = statSync("public/favicon.ico").size;
if (faviconBytes > MAX_FAVICON_BYTES) {
  failures.push(
    `favicon.ico is ${faviconBytes} bytes (budget ${MAX_FAVICON_BYTES}).`,
  );
}

console.log(
  JSON.stringify(
    {
      routes: results,
      largestChunk,
      faviconBytes,
    },
    null,
    2,
  ),
);

if (failures.length) {
  console.error(`Performance budget failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
}
