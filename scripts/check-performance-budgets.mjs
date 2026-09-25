import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
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
    name: "advertise",
    route: "/advertise",
    maxGzipBytes: 190_000,
  },
  {
    name: "videos",
    route: "/videos",
    maxGzipBytes: 185_000,
  },
  {
    name: "video",
    route: "/[username]/[repo]/video",
    maxGzipBytes: 185_000,
  },
];

// A chunk that any route loads up front must stay small; one oversized shared
// chunk slows every page.
const MAX_FIRST_LOAD_CHUNK_GZIP_BYTES = 100_000;
// Chunks loaded on demand (Mermaid and its ELK layout engine, loaded only when
// a diagram renders) get a separate, deliberate ceiling. Mermaid + ELK is the
// largest by far (~441 KB gzip after Mermaid 12); raise this only on purpose.
const MAX_LAZY_CHUNK_GZIP_BYTES = 550_000;
const MAX_FAVICON_BYTES = 20_000;

// The explainer video stage (public/video-engine) loads in an iframe on video
// pages and in the MP4 renderer. Its code is served as plain files, so budget
// it here: scripts, styles and HTML by gzip size (vendored GSAP included);
// fonts and media (already compressed) by raw size.
const VIDEO_ENGINE_DIR = "public/video-engine";
const videoEngineBudgets = [
  {
    name: "code (gzip)",
    extensions: [".js", ".css", ".html"],
    measure: "gzip",
    maxBytes: 70_000,
  },
  {
    name: "fonts",
    extensions: [".woff2", ".woff", ".ttf", ".otf"],
    measure: "raw",
    maxBytes: 200_000,
  },
  {
    name: "media",
    extensions: [".mp3", ".wav", ".ogg", ".png", ".jpg", ".jpeg", ".webp"],
    measure: "raw",
    maxBytes: 100_000,
  },
];

function gzipSize(file) {
  return gzipSync(readFileSync(file), { level: 9 }).length;
}

function listFiles(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
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

// Every route's first-load chunks, from all routes (not only budgeted ones).
const firstLoadChunks = new Set(
  routeBundleStats.flatMap((entry) =>
    (entry.firstLoadChunkPaths ?? []).map((chunk) => path.normalize(chunk)),
  ),
);
const staticChunks = listFiles(".next/static/chunks")
  .filter((file) => file.endsWith(".js"))
  .map((file) => ({
    chunk: path.relative(".next", file),
    gzipBytes: gzipSize(file),
    firstLoad: firstLoadChunks.has(path.normalize(file)),
  }))
  .sort((left, right) => right.gzipBytes - left.gzipBytes);
const largestFirstLoadChunk = staticChunks.find((chunk) => chunk.firstLoad);
const largestLazyChunk = staticChunks.find((chunk) => !chunk.firstLoad);

if (largestFirstLoadChunk?.gzipBytes > MAX_FIRST_LOAD_CHUNK_GZIP_BYTES) {
  failures.push(
    `${largestFirstLoadChunk.chunk} loads up front and is ${largestFirstLoadChunk.gzipBytes} gzip bytes (first-load chunk budget ${MAX_FIRST_LOAD_CHUNK_GZIP_BYTES}).`,
  );
}
if (largestLazyChunk?.gzipBytes > MAX_LAZY_CHUNK_GZIP_BYTES) {
  failures.push(
    `${largestLazyChunk.chunk} is ${largestLazyChunk.gzipBytes} gzip bytes (lazy chunk budget ${MAX_LAZY_CHUNK_GZIP_BYTES}).`,
  );
}

const videoEngineFiles = listFiles(VIDEO_ENGINE_DIR);
const videoEngine = videoEngineBudgets.map((budget) => {
  const files = videoEngineFiles.filter((file) =>
    budget.extensions.includes(path.extname(file).toLowerCase()),
  );
  const bytes = files.reduce(
    (total, file) =>
      total +
      (budget.measure === "gzip" ? gzipSize(file) : statSync(file).size),
    0,
  );
  if (bytes > budget.maxBytes) {
    failures.push(
      `Video engine ${budget.name} is ${bytes} bytes across ${files.length} files (budget ${budget.maxBytes}).`,
    );
  }
  return { name: budget.name, files: files.length, bytes };
});

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
      largestFirstLoadChunk,
      largestLazyChunk,
      videoEngine,
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
