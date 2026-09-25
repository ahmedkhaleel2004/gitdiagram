// Run after `bun run build`. The MP4 renderer needs native binaries that Next
// only ships because next.config.js lists them in outputFileTracingIncludes.
// Both failure modes are silent: ffmpeg-static only warns when its binary
// download fails, and a traced path that does not exist is skipped. Either way
// the deploy succeeds and renders fail in production, so fail the build here.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Real binaries are tens of megabytes; anything tiny is a stub or a failed
// download.
const ffmpeg = {
  file: "node_modules/ffmpeg-static/ffmpeg",
  minBytes: 10_000_000,
};
const chromium = {
  file: "node_modules/@sparticuz/chromium/bin/chromium.br",
  minBytes: 10_000_000,
};

// Chromium runs only in the segment route (frames and posters). The render
// route joins segments and generate voices narration, so they ship ffmpeg
// alone, and must not carry Chromium's ~60 MB.
const routes = [
  {
    route: "api/video/render",
    requiredFiles: [ffmpeg],
    forbiddenFiles: [chromium],
  },
  { route: "api/video/render/segment", requiredFiles: [ffmpeg, chromium] },
  {
    route: "api/video/generate",
    requiredFiles: [ffmpeg],
    forbiddenFiles: [chromium],
  },
];

const failures = [];

for (const { route, requiredFiles, forbiddenFiles = [] } of routes) {
  const nftFile = `.next/server/app/${route}/route.js.nft.json`;
  if (!existsSync(nftFile)) {
    failures.push(`${nftFile} is missing. Run the production build first.`);
    continue;
  }
  const { files } = JSON.parse(readFileSync(nftFile, "utf8"));
  const traced = new Set(
    files.map((file) =>
      path.relative(".", path.resolve(path.dirname(nftFile), file)),
    ),
  );
  for (const { file } of forbiddenFiles) {
    if (traced.has(path.normalize(file)))
      failures.push(`/${route} traces ${file}, which it does not use.`);
  }
  for (const { file, minBytes } of requiredFiles) {
    if (!traced.has(path.normalize(file))) {
      failures.push(`/${route} does not trace ${file}.`);
      continue;
    }
    const bytes = existsSync(file) ? statSync(file).size : 0;
    if (bytes < minBytes) {
      failures.push(
        `${file} is ${bytes} bytes (expected at least ${minBytes}); the binary is missing or incomplete.`,
      );
    }
  }
}

if (failures.length) {
  console.error(
    `Video render tracing check failed:\n- ${[...new Set(failures)].join("\n- ")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    "Video render routes trace the ffmpeg and Chromium binaries they need.",
  );
}
