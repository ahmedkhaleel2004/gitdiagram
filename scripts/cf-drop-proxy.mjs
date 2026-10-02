#!/usr/bin/env node
// Leaves the Next.js proxy (src/proxy.ts) out of the Cloudflare build.
//
// On Vercel the proxy runs as a Node function in front of the app. On
// Cloudflare, OpenNext would bundle it (and the 2.7 MB of Next.js server
// internals it is compiled against) into the Worker every request starts in,
// where it is the difference between a 0.3 MB and a 3 MB script to load in a
// new isolate. The Worker entry applies the same rules itself instead
// (cloudflare/worker.ts, from src/lib/proxy-rules.ts, which src/proxy.ts
// shares), so here the built app is told it has no proxy: OpenNext then
// builds its routing layer without one.
//
// Run by the OpenNext build right after `next build` (open-next.config.ts).
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const manifests = [
  ".next/server/functions-config-manifest.json",
  ".next/standalone/.next/server/functions-config-manifest.json",
];
let dropped = 0;
for (const file of manifests) {
  if (!existsSync(file)) continue;
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  if (!manifest.functions?.["/_middleware"]) continue;
  delete manifest.functions["/_middleware"];
  writeFileSync(file, JSON.stringify(manifest));
  dropped += 1;
}
console.log(
  dropped
    ? `Left the proxy out of the Cloudflare build (${dropped} manifest${dropped > 1 ? "s" : ""}).`
    : "No proxy in the build manifests; nothing to leave out.",
);
