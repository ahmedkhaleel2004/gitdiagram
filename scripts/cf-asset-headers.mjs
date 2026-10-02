#!/usr/bin/env node
// Writes .open-next/assets/_headers: the response headers for static files on
// Cloudflare.
//
// Workers Assets answers static files without running the Worker (free, and
// fast), so next.config.js `headers()` never sees them. This applies the same
// rules to every built asset and writes Cloudflare's `_headers` file, so a
// static file carries the same security and cache headers as on Vercel.
//
// Cloudflare joins the values when two `_headers` rules set one header, so the
// rules written here never overlap: a folder gets one `/*` rule only when all
// files under it share their headers; otherwise its entries get their own.
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const assetsDir = ".open-next/assets";
const MAX_RULES = 100; // Cloudflare's limit for a _headers file.

process.env.NODE_ENV = "production";
const { default: nextConfig } = await import("../next.config.js");
const headerRules = await nextConfig.headers();

/** A next.config `source` as a test for a path (the forms this repo uses). */
function matcher(source) {
  const pattern = source
    .split("/")
    .map((part) => {
      if (/^:[A-Za-z]+\*$/.test(part)) return "(?:.*)";
      if (/^:[A-Za-z]+$/.test(part)) return "[^/]+";
      if (part.includes(":") || /[()*+?]/.test(part))
        throw new Error(`Unsupported header source: ${source}`);
      return part.replace(/[.\\^$|[\]{}]/g, "\\$&");
    })
    .join("/")
    // `/x/:path*` also matches `/x`.
    .replace(/\/\(\?:\.\*\)$/, "(?:/.*)?");
  return new RegExp(`^${pattern}$`);
}

const rules = headerRules.map((rule) => {
  if (rule.has || rule.missing)
    throw new Error(`Conditional header rule not supported: ${rule.source}`);
  return { test: matcher(rule.source), headers: rule.headers };
});

/** The headers Vercel would put on this static path. */
function headersFor(path) {
  const headers = new Map();
  // Vercel lets any origin read a static file.
  headers.set("access-control-allow-origin", [
    "Access-Control-Allow-Origin",
    "*",
  ]);
  // Next's own rule for its content-hashed build output.
  if (path.startsWith("/_next/static/"))
    headers.set("cache-control", [
      "Cache-Control",
      "public, max-age=31536000, immutable",
    ]);
  // Later rules override earlier ones, as in Next.
  for (const rule of rules)
    if (rule.test.test(path))
      for (const { key, value } of rule.headers)
        headers.set(key.toLowerCase(), [key, value]);
  return [...headers.values()].sort(([a], [b]) => a.localeCompare(b));
}

function tree(dir, urlPath) {
  const node = { path: urlPath, children: [], files: [] };
  for (const name of readdirSync(dir).sort()) {
    if (urlPath === "" && name === "_headers") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory())
      node.children.push(tree(full, `${urlPath}/${name}`));
    else node.files.push(`${urlPath}/${name}`);
  }
  return node;
}

const signature = (path) => JSON.stringify(headersFor(path));

/** The one header set every file under `node` shares, or null. */
function uniform(node) {
  const seen = new Set(node.files.map(signature));
  for (const child of node.children) {
    const below = uniform(child);
    if (below === null) return null;
    seen.add(below);
  }
  // A path under the folder that is not a file today (hashed names change
  // between builds) must get the same headers as its siblings.
  seen.add(signature(`${node.path}/__any__`));
  return seen.size === 1 ? [...seen][0] : null;
}

const output = [];
function emit(node) {
  for (const file of node.files) output.push([file, headersFor(file)]);
  for (const child of node.children) {
    if (uniform(child) !== null)
      output.push([`${child.path}/*`, headersFor(`${child.path}/__any__`)]);
    else emit(child);
  }
}
emit(tree(assetsDir, ""));

const lines = [];
let count = 0;
for (const [path, headers] of output) {
  if (!headers.length) continue;
  count += 1;
  lines.push(path, ...headers.map(([key, value]) => `  ${key}: ${value}`), "");
}
if (count > MAX_RULES)
  throw new Error(`_headers would need ${count} rules (limit ${MAX_RULES}).`);
writeFileSync(join(assetsDir, "_headers"), lines.join("\n"));
console.log(`Wrote ${assetsDir}/_headers (${count} rules).`);

// The headers next.config.js puts on every path. OpenNext leaves them off
// redirects, proxy answers and rewritten (PostHog) responses; the Worker entry
// (cloudflare/worker.ts) adds them there.
const sitewide = Object.fromEntries(
  rules
    .filter((rule) => rule.test.test("/__any__/__path__"))
    .flatMap((rule) => rule.headers.map(({ key, value }) => [key, value])),
);
writeFileSync(".open-next/site-headers.json", JSON.stringify(sitewide));
