#!/usr/bin/env node
// Compares two deployments of the site (by default production and the
// Cloudflare Worker's test hostname): the same requests go to both, and the
// status, the headers that matter and the body are compared.
//
//   node scripts/compare-hosts.mjs
//   node scripts/compare-hosts.mjs --a https://gitdiagram.com --b https://example.workers.dev
//   node scripts/compare-hosts.mjs --only video --json /tmp/compare.json --verbose
//
// Exit code 1 when any request differs in a way that matters (FAIL); body or
// minor header differences are reported as WARN. Read-only: GET/HEAD requests,
// plus harmless POSTs that the routes refuse (no body, no credentials).

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const A = new URL(option("a", "https://gitdiagram.com")).origin;
const B = new URL(
  option("b", "https://gitdiagram.gitdiagram-presence.workers.dev"),
).origin;
const only = option("only", "");
const jsonPath = option("json", "");
const verbose = args.includes("--verbose");

const REPO = "/ahmedkhaleel2004/gitdiagram";
const BROWSER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** @type {{path: string, name?: string, method?: string, headers?: Record<string,string>, body?: "html"|"json"|"text"|"size"|"none", statusOnly?: boolean, jsonIgnore?: string[], requestBody?: string}[]} */
const REQUESTS = [
  // Pages
  { path: "/", body: "html" },
  { path: "/browse", body: "html" },
  { path: "/videos", body: "html" },
  { path: "/reels", body: "html" },
  { path: "/advertise", body: "html" },
  { path: "/visualize-codebase", body: "html" },
  { path: "/privacy", body: "html" },
  { path: "/terms", body: "html" },
  { path: "/support", body: "html" },
  { path: "/admin", body: "html" },
  { path: REPO, body: "html" },
  { path: `${REPO}/video`, body: "html" },
  { path: "/vercel/next.js", body: "html" },
  { path: "/this-owner-does-not-exist-0/nor-this-repo", body: "html" },
  { path: "/no-such-page", body: "html" },
  // Redirects
  { path: "/sponsor", body: "none" },
  { path: "/watch", body: "none" },
  { path: "/AhmedKhaleel2004/GitDiagram?utm_source=x", body: "none" },
  { path: `${REPO}/tree/main/src`, body: "none" },
  { path: `${REPO}/twitter-image`, body: "none" },
  { path: "/out/sent", body: "none" },
  // Search engines and agents
  { path: "/robots.txt", body: "text" },
  { path: "/sitemap.xml", body: "none" },
  { path: "/sitemap/0.xml", body: "size" },
  { path: "/llms.txt", body: "text" },
  { path: "/llms-full.txt", body: "text" },
  { path: `${REPO}.md`, body: "text" },
  {
    path: REPO,
    name: `${REPO} (Accept: text/markdown)`,
    headers: { accept: "text/markdown" },
    body: "text",
  },
  { path: `${REPO}/llms.txt`, body: "text" },
  {
    path: REPO,
    name: `${REPO} (ClaudeBot)`,
    headers: { "user-agent": "Mozilla/5.0 (compatible; ClaudeBot/1.0)" },
    body: "none",
    // Blocked by the firewall on both; each platform has its own block page.
    statusOnly: true,
  },
  { path: "/.well-known/openai-apps-challenge", body: "text" },
  // Pictures and static files
  { path: `${REPO}/opengraph-image`, body: "size" },
  { path: `${REPO}/diagram.png`, body: "size" },
  { path: "/opengraph-image.png", body: "size" },
  { path: "/twitter-image.png", body: "size" },
  { path: "/favicon.ico", body: "size" },
  { path: "/diagram-badge.svg", body: "text" },
  { path: "/video-badge.svg", body: "text" },
  { path: "/sponsors/sent-logo.png", body: "size" },
  { path: "/video-engine/stage.html", body: "text" },
  { path: "/video-engine/stage.js", body: "text" },
  { path: "/video-engine/engine.css", body: "text" },
  { path: "/mcp-app/diagram-view.js", body: "none" },
  // APIs
  { path: "/api/healthz", body: "json", jsonIgnore: ["*"] },
  { path: "/api/sponsor", body: "json", jsonIgnore: ["*"] },
  { path: "/api/analytics-context", body: "json" },
  {
    path: "/api/video?username=ahmedkhaleel2004&repo=gitdiagram",
    body: "json",
  },
  {
    path: "/api/video?username=this-owner-does-not-exist-0&repo=nope",
    body: "json",
    jsonIgnore: ["*"],
  },
  { path: "/api/video/catalog", body: "json", jsonIgnore: ["*"] },
  {
    path: "/api/video/file?username=ahmedkhaleel2004&repo=gitdiagram&format=poster",
    body: "size",
  },
  { path: "/api/browse-index", body: "size" },
  {
    path: "/api/diagram-preview?username=ahmedkhaleel2004&repo=gitdiagram",
    body: "json",
    jsonIgnore: ["*"],
  },
  { path: "/api/admin/state", body: "json" },
  { path: "/api/internal/browse-index/drain", body: "json" },
  { path: "/api/internal/video-payments/sweep", body: "json" },
  { path: "/api/internal/ai-visibility", body: "json" },
  { path: "/api/generate/stream", method: "POST", body: "none" },
  { path: "/api/generate/cost", method: "POST", body: "none" },
  { path: "/api/diagram-state", method: "POST", body: "none" },
  { path: "/api/video/generate", method: "POST", body: "none" },
  { path: "/api/video/checkout", method: "POST", body: "none" },
  {
    path: "/",
    name: "/ (forged next-action)",
    method: "POST",
    headers: { "next-action": "x" },
    body: "none",
  },
  // MCP
  { path: "/mcp", body: "text" },
  {
    path: "/mcp",
    name: "/mcp (initialize)",
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    requestBody: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "compare-hosts", version: "1.0.0" },
      },
    }),
    body: "json",
  },
  {
    path: "/mcp",
    name: "/mcp (tools/list)",
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    requestBody: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    }),
    body: "json",
  },
  // PostHog, same origin
  { path: "/phx9a/static/array.js", body: "size" },
  { path: "/phx9a/decide/?v=3", body: "none" },
];

// Headers that must match exactly (after replacing each host's own origin).
const STRICT_HEADERS = [
  "location",
  "content-security-policy",
  "x-content-type-options",
  "referrer-policy",
  "strict-transport-security",
  "permissions-policy",
  "x-robots-tag",
  "link",
  "allow",
];
// Headers worth seeing, where a difference is not a failure by itself.
// Vercel adds the last two to every static file and prerendered page.
const SOFT_HEADERS = [
  "access-control-allow-origin",
  "content-disposition",
  "content-type",
  "cache-control",
  "cdn-cache-control",
  "vary",
];

// Each host may name itself or the canonical site in links.
const withoutOrigins = (text) =>
  text.replaceAll(A, "{origin}").replaceAll(B, "{origin}");

const PRODUCTION = "https://gitdiagram.com";

const normalizeHeader = (name, value, origin) => {
  // Vercel and the Worker both add `noindex` on any hostname but the site's.
  if (name === "x-robots-tag" && value !== null && origin !== PRODUCTION)
    value =
      value
        .split(",")
        .map((part) => part.trim())
        .filter(
          (part, index, parts) =>
            part !== "noindex" || parts.indexOf(part) !== index,
        )
        .join(", ") || null;
  if (value === null) return null;
  let text = withoutOrigins(value).trim();
  if (name === "content-type")
    text = text.toLowerCase().replace(/;\s*charset=utf-8/, "");
  if (name === "link")
    // Preloads name build files and whatever the page happened to show; the
    // links that must match are the others (rel="canonical").
    text = text
      .split(/,\s*(?=<)/)
      .filter((part) => !/rel="?preload/.test(part))
      .join(", ");
  if (name === "vary")
    text = text
      .toLowerCase()
      .split(",")
      .map((part) => part.trim())
      // Next's own router headers; Vercel and OpenNext list them differently.
      .filter((part) => part && !/^(rsc|next-router-|next-url)/.test(part))
      .sort()
      .join(", ");
  return text || null;
};

const decodeEntities = (text) =>
  text
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

/** What a person or a crawler reads from a page, without build noise. */
function htmlSummary(html) {
  const pick = (pattern) => decodeEntities(pattern.exec(html)?.[1] ?? "");
  const meta = (key) =>
    pick(
      new RegExp(
        `<meta[^>]+(?:name|property)="${key}"[^>]+content="([^"]*)"`,
        "i",
      ),
    );
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<template[\s\S]*?<\/template>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
  const jsonLd = [
    ...html.matchAll(
      /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ].map((match) => match[1].length);
  return {
    title: pick(/<title>([^<]*)<\/title>/i),
    description: meta("description"),
    robots: meta("robots"),
    canonical: pick(/<link[^>]+rel="canonical"[^>]+href="([^"]*)"/i),
    ogImage: meta("og:image").replace(/\?.*$/, ""),
    jsonLdBlocks: jsonLd.length,
    text,
  };
}

function firstDifference(a, b) {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index++;
  const from = Math.max(0, index - 30);
  return `at ${index}: "${a.slice(from, index + 50)}" vs "${b.slice(from, index + 50)}"`;
}

function compareJson(a, b, ignore, path = "") {
  if (ignore.includes("*")) {
    // Live data: compare the shape (top-level keys) only.
    const keys = (value) =>
      value && typeof value === "object"
        ? Object.keys(value).sort().join(",")
        : typeof value;
    return keys(a) === keys(b) ? [] : [`keys: ${keys(a)} vs ${keys(b)}`];
  }
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (
    a &&
    b &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a)
  ) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(
      (key) =>
        ignore.includes(key)
          ? []
          : compareJson(a[key], b[key], ignore, `${path}.${key}`),
    );
  }
  return [
    `${path || "(root)"}: ${JSON.stringify(a)?.slice(0, 80)} vs ${JSON.stringify(b)?.slice(0, 80)}`,
  ];
}

async function call(origin, request) {
  const startedAt = performance.now();
  try {
    const response = await fetch(origin + request.path, {
      method: request.method ?? "GET",
      redirect: "manual",
      headers: { "user-agent": BROWSER, accept: "*/*", ...request.headers },
      body: request.requestBody,
      signal: AbortSignal.timeout(60_000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      status: response.status,
      headers: response.headers,
      bytes,
      ms: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return { error: String(error?.cause?.code ?? error?.message ?? error) };
  }
}

function compare(request, a, b) {
  const fail = [];
  const warn = [];
  if (a.error || b.error) {
    fail.push(`request failed: ${a.error ?? "ok"} vs ${b.error ?? "ok"}`);
    return { fail, warn };
  }
  if (a.status !== b.status) fail.push(`status ${a.status} vs ${b.status}`);
  if (request.statusOnly) return { fail, warn };
  for (const name of [...STRICT_HEADERS, ...SOFT_HEADERS]) {
    const left = normalizeHeader(name, a.headers.get(name), A);
    const right = normalizeHeader(name, b.headers.get(name), B);
    if (left === right) continue;
    (STRICT_HEADERS.includes(name) ? fail : warn).push(
      `${name}: ${left ?? "(none)"} vs ${right ?? "(none)"}`,
    );
  }
  if (a.status !== b.status) return { fail, warn };
  const mode = request.body ?? "none";
  const textA = withoutOrigins(a.bytes.toString("utf8"));
  const textB = withoutOrigins(b.bytes.toString("utf8"));
  if (mode === "text" && textA !== textB)
    warn.push(`body differs ${firstDifference(textA, textB)}`);
  if (mode === "size") {
    const [x, y] = [a.bytes.length, b.bytes.length];
    if (Math.abs(x - y) > Math.max(x, y) * 0.05)
      warn.push(`body size ${x} vs ${y} bytes`);
  }
  if (mode === "json") {
    try {
      const differences = compareJson(
        JSON.parse(textA),
        JSON.parse(textB),
        request.jsonIgnore ?? [],
      );
      if (differences.length)
        warn.push(`json differs ${differences.slice(0, 4).join("; ")}`);
    } catch {
      if (textA !== textB)
        warn.push(`body differs ${firstDifference(textA, textB)}`);
    }
  }
  if (mode === "html") {
    const [x, y] = [htmlSummary(textA), htmlSummary(textB)];
    for (const key of [
      "title",
      "description",
      "robots",
      "canonical",
      "ogImage",
      "jsonLdBlocks",
    ])
      if (x[key] !== y[key]) fail.push(`${key}: "${x[key]}" vs "${y[key]}"`);
    if (x.text !== y.text)
      warn.push(
        `visible text differs (${x.text.length} vs ${y.text.length} chars) ${firstDifference(x.text, y.text)}`,
      );
  }
  return { fail, warn };
}

const selected = REQUESTS.filter(
  (request) => !only || (request.name ?? request.path).includes(only),
);
console.log(`A = ${A}\nB = ${B}\n`);
const results = [];
let failures = 0;
let warnings = 0;
// A few at a time: enough to be quick, never enough to trip a rate limit.
for (let index = 0; index < selected.length; index += 4) {
  const batch = selected.slice(index, index + 4);
  const settled = await Promise.all(
    batch.map(async (request) => {
      const [a, b] = await Promise.all([call(A, request), call(B, request)]);
      return { request, a, b, ...compare(request, a, b) };
    }),
  );
  for (const { request, a, b, fail, warn } of settled) {
    const label = `${request.method ?? "GET"} ${request.name ?? request.path}`;
    const verdict = fail.length ? "FAIL" : warn.length ? "WARN" : "ok  ";
    failures += fail.length ? 1 : 0;
    warnings += !fail.length && warn.length ? 1 : 0;
    console.log(
      `${verdict} ${String(a.status ?? "ERR").padEnd(3)} ${String(b.status ?? "ERR").padEnd(3)} ${String(a.ms ?? "-").padStart(5)}ms ${String(b.ms ?? "-").padStart(5)}ms  ${label}`,
    );
    for (const line of fail)
      console.log(`       FAIL ${line.slice(0, verbose ? 2000 : 240)}`);
    for (const line of warn)
      console.log(`       warn ${line.slice(0, verbose ? 2000 : 240)}`);
    results.push({
      request: label,
      a: { status: a.status, ms: a.ms, bytes: a.bytes?.length, error: a.error },
      b: { status: b.status, ms: b.ms, bytes: b.bytes?.length, error: b.error },
      fail,
      warn,
    });
  }
}
console.log(
  `\n${selected.length} requests: ${selected.length - failures - warnings} identical, ${warnings} with warnings, ${failures} failed.`,
);
if (jsonPath) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(jsonPath, JSON.stringify({ a: A, b: B, results }, null, 2));
}
process.exit(failures ? 1 : 0);
