#!/usr/bin/env node
// Latency and cache benchmark for the site. Every caching or start-up change
// is judged against these numbers (the results table lives in the migration
// log, STATUS.md).
//
//   node scripts/bench.mjs local   [--host URL] [--n 20]       this machine, curl
//   node scripts/bench.mjs global  [--host URL] [--rounds 3]   Globalping probes
//   node scripts/bench.mjs vitals  [--host URL] [--runs 3] [--psi]   Lighthouse, mobile
//   node scripts/bench.mjs cache   [--hours 6]                 Cloudflare analytics
//
// Common: --only <name,name>  --json <file>  --label <text>
//         --dns <resolver> | --ip <address>   (local: where the host is)
//
// local   New connection per request ("cold connection": DNS, TCP, TLS, then
//         the wait for the first byte) and requests on one kept-alive
//         connection ("warm": the wait alone). `wait` is what the server and
//         its cache spent; the handshake is the network's.
// global  One probe per city asks for the page; later rounds reuse the same
//         probes. Round 1 is what a first visitor in that region gets (a cold
//         isolate and location cache if nobody was there lately), the later
//         rounds are the warm path. Unauthenticated Globalping allows 250
//         probe-requests an hour: a run costs URLs x cities x rounds.
// vitals  Lighthouse in headless Chrome with its default mobile profile
//         (slow 4G, 4x CPU slowdown): LCP, FCP, TBT, CLS, TTFB. With --psi the
//         same test runs on Google's machines (PageSpeed Insights), which is
//         how to measure a host this machine cannot reach.
// cache   Edge cache status of every request the zone served (GraphQL
//         analytics; needs CLOUDFLARE_API_TOKEN or the token file).
import { execFile } from "node:child_process";
import { Resolver } from "node:dns/promises";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);

const [mode, ...rest] = process.argv.slice(2);
const flags = {};
for (let i = 0; i < rest.length; i += 1)
  if (rest[i].startsWith("--")) {
    const next = rest[i + 1];
    flags[rest[i].slice(2)] = next && !next.startsWith("--") ? rest[++i] : "1";
  }

const HOST = (flags.host ?? "https://gitdiagram.com").replace(/\/+$/, "");
const ZONE = "4709d18806151b68cbbba34ddac80252";

// The fixed set. `repo` is a page many people open, `tail` one almost nobody
// does (so its copies in the location caches are usually gone).
const URLS = [
  { name: "home", path: "/" },
  { name: "repo", path: "/ahmedkhaleel2004/gitdiagram" },
  { name: "tail", path: "/sindresorhus/yocto-spinner" },
  { name: "videos", path: "/videos" },
  { name: "watch", path: "/ahmedkhaleel2004/gitdiagram/video" },
  { name: "og", path: "/ahmedkhaleel2004/gitdiagram/opengraph-image" },
  {
    name: "api-video",
    path: "/api/video?username=ahmedkhaleel2004&repo=gitdiagram",
  },
  { name: "api-catalog", path: "/api/video/catalog" },
  { name: "api-health", path: "/api/healthz" },
  { name: "static", path: "/favicon.ico" },
].filter(({ name }) => !flags.only || flags.only.split(",").includes(name));

const CITIES = (
  flags.cities ??
  "New York,San Francisco,Sao Paulo,London,Frankfurt,Johannesburg,Mumbai,Singapore,Tokyo,Sydney"
).split(",");

// Where the host really is today. While the nameserver move is still in
// resolvers' caches, this machine's own resolver may answer with the old
// platform's address; a public resolver has the current one.
let pinned;
async function resolveArgs() {
  if (pinned) return pinned;
  const { hostname } = new URL(HOST);
  let address = flags.ip;
  if (!address) {
    const resolver = new Resolver();
    resolver.setServers([flags.dns ?? "1.1.1.1"]);
    [address] = await resolver.resolve4(hostname);
  }
  pinned = ["--resolve", `${hostname}:443:${address}`];
  return pinned;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}
const stats = (values) => ({
  n: values.length,
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  p99: percentile(values, 0.99),
  max: values.length ? Math.max(...values) : null,
});
const ms = (value) => (value == null ? "-" : String(Math.round(value)));
const cell = ({ p50, p95, p99 }) => `${ms(p50)} / ${ms(p95)} / ${ms(p99)}`;

function finish(result, lines) {
  const text = lines.join("\n");
  console.log(text);
  if (flags.json)
    writeFileSync(
      flags.json,
      JSON.stringify(
        {
          mode,
          host: HOST,
          label: flags.label ?? null,
          at: new Date().toISOString(),
          ...result,
        },
        null,
        1,
      ),
    );
}

// --- local -----------------------------------------------------------------

const CURL_FORMAT =
  '{"status":%{http_code},"connect":%{time_appconnect},"start":%{time_starttransfer},"total":%{time_total},"pre":%{time_pretransfer},"size":%{size_download},"reused":%{num_connects}}\\n';

async function curl(url, times) {
  // One curl process: `times` transfers of the same URL share a connection.
  // Paced: the zone blocks an address that sends 100 requests in 10 s.
  const args = [
    ...(await resolveArgs()),
    ...(times > 1 ? ["--rate", "6/s"] : []),
    "-s",
    "--compressed",
    "-H",
    "accept-encoding: zstd, br, gzip",
    "-A",
    "gitdiagram-bench/1.0",
  ];
  for (let i = 0; i < times; i += 1)
    args.push("-o", "/dev/null", "-w", CURL_FORMAT, url);
  const { stdout } = await run("curl", args, { maxBuffer: 1 << 24 });
  return stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

async function local() {
  const n = Number(flags.n ?? 20);
  const rows = [];
  for (const { name, path } of URLS) {
    const fresh = [];
    for (let i = 0; i < n; i += 1) {
      fresh.push((await curl(HOST + path, 1))[0]);
      await sleep(Number(flags.gap ?? 200));
    }
    // The first transfer opens the connection; the rest reuse it.
    const kept = (await curl(HOST + path, n + 1)).slice(1);
    const bad = [...fresh, ...kept].filter((r) => r.status !== 200).length;
    rows.push({
      name,
      path,
      bad,
      handshake: stats(fresh.map((r) => r.connect * 1000)),
      coldTtfb: stats(fresh.map((r) => r.start * 1000)),
      coldWait: stats(fresh.map((r) => (r.start - r.pre) * 1000)),
      coldTotal: stats(fresh.map((r) => r.total * 1000)),
      warmTtfb: stats(kept.map((r) => r.start * 1000)),
      warmTotal: stats(kept.map((r) => r.total * 1000)),
      bytes: fresh[0]?.size,
    });
  }
  const lines = [
    `local: ${HOST} (n=${n} per connection kind; ms, p50 / p95 / p99)`,
    "",
    "| URL | new connection TTFB | of which server wait | new connection full load | kept-alive TTFB | kept-alive full load | not 200 |",
    "|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.name} | ${cell(r.coldTtfb)} | ${cell(r.coldWait)} | ${cell(r.coldTotal)} | ${cell(r.warmTtfb)} | ${cell(r.warmTotal)} | ${r.bad} |`,
    ),
  ];
  finish({ rows }, lines);
}

// --- global ----------------------------------------------------------------

async function globalping(body) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch("https://api.globalping.io/v1/measurements", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.GLOBALPING_TOKEN
          ? { authorization: `Bearer ${process.env.GLOBALPING_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(body),
    });
    if (response.status === 429 && attempt < 1) {
      const wait = Number(response.headers.get("retry-after") ?? 60);
      console.error(`Globalping limit reached; waiting ${wait} s`);
      await sleep((wait + 1) * 1000);
      continue;
    }
    if (!response.ok)
      throw new Error(
        `Globalping ${response.status}: ${await response.text()}`,
      );
    const { id } = await response.json();
    for (let i = 0; i < 40; i += 1) {
      await sleep(1500);
      const result = await (
        await fetch(`https://api.globalping.io/v1/measurements/${id}`)
      ).json();
      if (result.status !== "in-progress")
        return { id, results: result.results };
    }
    throw new Error(`Globalping measurement ${id} did not finish`);
  }
}

async function global() {
  const rounds = Number(flags.rounds ?? 3);
  const host = new URL(HOST).host;
  const rows = [];
  for (const { name, path } of URLS) {
    const [pathname, query] = path.split("?");
    const options = {
      protocol: "HTTPS",
      request: { method: "GET", path: pathname, ...(query ? { query } : {}) },
    };
    let probes = CITIES.map((city) => ({ city, limit: 1 }));
    const perCity = new Map();
    for (let round = 0; round < rounds; round += 1) {
      const { id, results } = await globalping({
        type: "http",
        target: host,
        locations: probes,
        measurementOptions: options,
      });
      probes = id; // the same probes again
      results.forEach(({ probe, result }, index) => {
        const key = `${CITIES[index] ?? probe.city}`;
        const entry = perCity.get(key) ?? {
          city: probe.city,
          country: probe.country,
          network: probe.network,
          rounds: [],
        };
        const headers = result.headers ?? {};
        entry.rounds.push({
          status: result.statusCode ?? null,
          firstByte: result.timings?.firstByte ?? null,
          total: result.timings?.total ?? null,
          handshake:
            (result.timings?.dns ?? 0) +
            (result.timings?.tcp ?? 0) +
            (result.timings?.tls ?? 0),
          cache:
            headers["x-edge-cache"] ??
            headers["x-opennext-cache"] ??
            headers["cf-cache-status"] ??
            headers["x-vercel-cache"] ??
            "",
          // The Worker's own account of the request (cloudflare/worker.ts).
          edge: String(headers["server-timing"] ?? ""),
          colo: String(headers["cf-ray"] ?? headers["x-vercel-id"] ?? "")
            .split(/[-:]/)
            .at(headers["cf-ray"] ? -1 : 0),
        });
        perCity.set(key, entry);
      });
    }
    rows.push({ name, path, cities: Object.fromEntries(perCity) });
  }
  const lines = [
    `global: ${HOST} (Globalping, one probe per city, ${rounds} rounds; ms to first byte after the handshake: round 1, then the median of the later rounds)`,
    "",
    `| URL | ${CITIES.join(" | ")} | first round p50 / worst | later rounds p50 / p95 |`,
    `|---|${CITIES.map(() => "---|").join("")}---|---|`,
  ];
  for (const row of rows) {
    const firsts = [];
    const laters = [];
    const cells = CITIES.map((city) => {
      const entry = row.cities[city];
      if (!entry) return "-";
      const [first, ...later] = entry.rounds.map((r) =>
        r.status === 200 ? r.firstByte : null,
      );
      const ok = later.filter((v) => v != null);
      if (first != null) firsts.push(first);
      laters.push(...ok);
      return `${ms(first)}, ${ms(percentile(ok, 0.5))}`;
    });
    lines.push(
      `| ${row.name} | ${cells.join(" | ")} | ${ms(percentile(firsts, 0.5))} / ${ms(Math.max(...firsts))} | ${ms(percentile(laters, 0.5))} / ${ms(percentile(laters, 0.95))} |`,
    );
  }
  finish({ rows }, lines);
}

// --- vitals ----------------------------------------------------------------

/** One Lighthouse run in this machine's Chrome; the report's JSON. */
async function lighthouseHere(url, chrome) {
  // Chrome must find the host where it really is too (see resolveArgs).
  const [, mapping] = await resolveArgs();
  const [hostname, , address] = mapping.split(":");
  const { stdout } = await run(
    "bunx",
    [
      "lighthouse@12",
      url,
      "--quiet",
      "--output=json",
      "--only-categories=performance",
      `--chrome-flags=--headless=new --no-sandbox --disable-gpu --host-resolver-rules="MAP ${hostname} ${address}"`,
    ],
    {
      maxBuffer: 1 << 28,
      env: { ...process.env, ...(chrome ? { CHROME_PATH: chrome } : {}) },
    },
  );
  return JSON.parse(stdout);
}

/** One Lighthouse run on Google's machines (PageSpeed Insights). */
async function lighthouseAtGoogle(url) {
  const api = new URL(
    "https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
  );
  api.searchParams.set("url", url);
  api.searchParams.set("strategy", "mobile");
  api.searchParams.set("category", "performance");
  // Without a key the API shares one small quota with everyone.
  const keyFile = `${homedir()}/.config/gitdiagram/pagespeed-api-key`;
  const key =
    process.env.PAGESPEED_API_KEY ??
    (existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : "");
  if (key) api.searchParams.set("key", key);
  const response = await fetch(api);
  if (!response.ok)
    throw new Error(`PageSpeed ${response.status}: ${await response.text()}`);
  return (await response.json()).lighthouseResult;
}

async function vitals() {
  const runs = Number(flags.runs ?? 3);
  const chrome =
    process.env.CHROME_PATH ??
    ["/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
  const pages = URLS.filter(({ name }) =>
    ["home", "repo", "videos", "watch"].includes(name),
  );
  const rows = [];
  for (const { name, path } of pages) {
    const samples = [];
    for (let i = 0; i < runs; i += 1) {
      const { audits, categories } = flags.psi
        ? await lighthouseAtGoogle(HOST + path)
        : await lighthouseHere(HOST + path, chrome);
      samples.push({
        score: Math.round(categories.performance.score * 100),
        ttfb: audits["server-response-time"].numericValue,
        fcp: audits["first-contentful-paint"].numericValue,
        lcp: audits["largest-contentful-paint"].numericValue,
        tbt: audits["total-blocking-time"].numericValue,
        cls: audits["cumulative-layout-shift"].numericValue,
        bytes: audits["total-byte-weight"].numericValue,
      });
    }
    const median = (key) =>
      percentile(
        samples.map((s) => s[key]),
        0.5,
      );
    rows.push({
      name,
      path,
      samples,
      score: median("score"),
      ttfb: median("ttfb"),
      fcp: median("fcp"),
      lcp: median("lcp"),
      tbt: median("tbt"),
      cls: median("cls"),
      bytes: median("bytes"),
    });
  }
  finish({ rows }, [
    `vitals: ${HOST} (Lighthouse mobile profile ${flags.psi ? "on PageSpeed Insights" : "in local Chrome"}, median of ${runs})`,
    "",
    "| Page | score | TTFB ms | FCP ms | LCP ms | TBT ms | CLS | transfer KB |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.name} | ${r.score} | ${ms(r.ttfb)} | ${ms(r.fcp)} | ${ms(r.lcp)} | ${ms(r.tbt)} | ${r.cls.toFixed(3)} | ${ms(r.bytes / 1024)} |`,
    ),
  ]);
}

// --- cache -----------------------------------------------------------------

async function cache() {
  const tokenFile = `${homedir()}/.config/gitdiagram/cloudflare-api-token`;
  const token =
    process.env.CLOUDFLARE_API_TOKEN ??
    (existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : "");
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not set");
  const hours = Number(flags.hours ?? 6);
  const until = new Date();
  const since = new Date(until.getTime() - hours * 3600_000);
  const query = `query ($zone: String!, $since: Time!, $until: Time!) {
    viewer { zones(filter: { zoneTag: $zone }) {
      byStatus: httpRequestsAdaptiveGroups(limit: 50, filter: { datetime_geq: $since, datetime_lt: $until, requestSource: "eyeball" }) {
        count dimensions { cacheStatus } sum { edgeResponseBytes }
      }
      byType: httpRequestsAdaptiveGroups(limit: 200, filter: { datetime_geq: $since, datetime_lt: $until, requestSource: "eyeball" }) {
        count dimensions { cacheStatus edgeResponseContentTypeName }
      }
    } } }`;
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: {
        zone: ZONE,
        since: since.toISOString(),
        until: until.toISOString(),
      },
    }),
  });
  const body = await response.json();
  if (body.errors?.length) throw new Error(JSON.stringify(body.errors));
  const zone = body.data.viewer.zones[0];
  const total = zone.byStatus.reduce((sum, g) => sum + g.count, 0);
  const lines = [
    `cache: gitdiagram.com, last ${hours} h, ${total} visitor requests (sampled)`,
    "",
    "| Edge cache status | requests | share | bytes |",
    "|---|---|---|---|",
    ...zone.byStatus
      .sort((a, b) => b.count - a.count)
      .map(
        (g) =>
          `| ${g.dimensions.cacheStatus} | ${g.count} | ${((100 * g.count) / total).toFixed(1)}% | ${g.sum.edgeResponseBytes} |`,
      ),
    "",
    "| Content type | requests | served from the edge cache (hit, stale, revalidated, updating) |",
    "|---|---|---|",
  ];
  const types = new Map();
  for (const g of zone.byType) {
    const key = g.dimensions.edgeResponseContentTypeName || "(none)";
    const entry = types.get(key) ?? { total: 0, hit: 0 };
    entry.total += g.count;
    if (
      ["hit", "stale", "revalidated", "updating"].includes(
        g.dimensions.cacheStatus,
      )
    )
      entry.hit += g.count;
    types.set(key, entry);
  }
  for (const [type, { total: all, hit }] of [...types].sort(
    (a, b) => b[1].total - a[1].total,
  ))
    lines.push(`| ${type} | ${all} | ${((100 * hit) / all).toFixed(1)}% |`);
  finish({ byStatus: zone.byStatus, byType: zone.byType }, lines);
}

const modes = { local, global, vitals, cache };
if (!modes[mode]) {
  console.error(
    "Usage: node scripts/bench.mjs local|global|vitals|cache [flags]",
  );
  process.exit(2);
}
await modes[mode]();
