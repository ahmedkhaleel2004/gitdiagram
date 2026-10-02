#!/usr/bin/env node
// What Cloudflare has cost so far this billing period, and what a month at
// the current traffic would cost.
//
//   node scripts/cf-usage.mjs               period to date + projection from the last 24 h
//   node scripts/cf-usage.mjs --hours 6     project from the last 6 hours instead
//   node scripts/cf-usage.mjs --site        without test and staging Workers
//   node scripts/cf-usage.mjs --json        the same numbers as JSON
//   node scripts/cf-usage.mjs --hours 6 --fail-above 150
//                                           one line; exit 1 when the projected
//                                           month is over $150 (the hourly
//                                           cost watch, .github/workflows)
//
// Reads Cloudflare's analytics (GraphQL), the Workers Logs query API and the
// billing API. Needs CLOUDFLARE_API_TOKEN, or the token file on the server
// (~/.config/gitdiagram/cloudflare-api-token). It changes nothing.
//
// Prices are Cloudflare's list prices, read from its pricing pages on
// 2026-10-02 (Workers and Containers pages dated 2026-08-28, Durable Objects
// 2026-09-30, R2 2026-10-01). Allowances are per account and per month, so
// every Worker on the account counts, not just the site.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ACCOUNT =
  process.env.CLOUDFLARE_ACCOUNT_ID ?? "8a4f309f2639721dc9f4f0d1790fd6d5";
// gitdiagram.com moved from Vercel to Cloudflare at this moment; a projection
// never looks further back.
const LIVE_SINCE = Date.parse("2026-10-02T10:13:00Z");
const VERCEL_MONTHLY = 102.56; // the last full Vercel bill: $82.56 usage + $20 Pro
const MONTH_HOURS = 730;
const GIB = 2 ** 30;

/** One billed line: what a unit is, what is included, what the rest costs. */
const PRICES = {
  workerRequests: { included: 10e6, per: 1e6, price: 0.3 },
  workerCpuMs: { included: 30e6, per: 1e6, price: 0.02 },
  doRequests: { included: 1e6, per: 1e6, price: 0.15 },
  doDurationGbS: { included: 400_000, per: 1e6, price: 12.5 },
  doRowsRead: { included: 25e9, per: 1e6, price: 0.001 },
  doRowsWritten: { included: 50e6, per: 1e6, price: 1 },
  r2ClassA: { included: 1e6, per: 1e6, price: 4.5 },
  r2ClassB: { included: 10e6, per: 1e6, price: 0.36 },
  r2StorageGb: { included: 10, per: 1, price: 0.015 },
  containerCpuS: { included: 375 * 60, per: 1, price: 0.00002 },
  containerMemGibS: { included: 25 * 3600, per: 1, price: 0.0000025 },
  containerDiskGbS: { included: 200 * 3600, per: 1, price: 0.00000007 },
  logEvents: { included: 20e6, per: 1e6, price: 0.6 },
};
const WORKERS_PAID = 5;

const LABELS = {
  workerRequests: "Worker requests",
  workerCpuMs: "Worker CPU (ms)",
  doRequests: "Durable Object requests",
  doDurationGbS: "Durable Object duration (GB-s)",
  doRowsRead: "Durable Object rows read",
  doRowsWritten: "Durable Object rows written",
  r2ClassA: "R2 writes and lists (class A)",
  r2ClassB: "R2 reads (class B)",
  r2StorageGb: "R2 storage (GB)",
  containerCpuS: "Container CPU (vCPU-s)",
  containerMemGibS: "Container memory (GiB-s)",
  containerDiskGbS: "Container disk (GB-s)",
  logEvents: "Stored log events",
};

// R2 operations by billing class (r2/pricing). Deletes and aborts are free.
const R2_CLASS_A =
  /^(Put|Copy|List|CreateMultipartUpload|CompleteMultipartUpload|UploadPart|LifecycleStorageTierTransition)/;
const R2_FREE = /^(Delete|Abort)/;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

function token() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  try {
    return readFileSync(
      join(homedir(), ".config/gitdiagram/cloudflare-api-token"),
      "utf8",
    ).trim();
  } catch {
    console.error(
      "Set CLOUDFLARE_API_TOKEN (Account Analytics read; Billing read for the billed figures).",
    );
    process.exit(1);
  }
}
const TOKEN = token();
const api = "https://api.cloudflare.com/client/v4";
const headers = {
  authorization: `Bearer ${TOKEN}`,
  "content-type": "application/json",
};

async function rest(path, init) {
  const response = await fetch(`${api}${path}`, { ...init, headers });
  const body = await response.json().catch(() => null);
  if (!body?.success) throw new Error(`${path}: ${response.status}`);
  return body.result;
}

/** One analytics dataset for the account; an empty list when it cannot be read. */
async function dataset(name, selection, from, to, extraFilter = "") {
  const query = `{viewer{accounts(filter:{accountTag:"${ACCOUNT}"}){${name}(limit:10000,filter:{datetime_geq:"${iso(from)}",datetime_leq:"${iso(to)}"${extraFilter}}){${selection}}}}}`;
  const response = await fetch(`${api}/graphql`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });
  const body = await response.json().catch(() => null);
  if (body?.errors?.length) {
    problems.push(`${name}: ${body.errors[0].message}`);
    return [];
  }
  return body?.data?.viewer?.accounts?.[0]?.[name] ?? [];
}

const problems = [];
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
const sum = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0);

/** Stored log events (what is billed), by Worker. */
async function logEvents(from, to) {
  try {
    const result = await rest(
      `/accounts/${ACCOUNT}/workers/observability/telemetry/query`,
      {
        method: "POST",
        body: JSON.stringify({
          queryId: "cf-usage",
          timeframe: { from, to },
          view: "calculations",
          parameters: {
            datasets: ["cloudflare-workers"],
            calculations: [{ operator: "count", alias: "n" }],
            groupBys: [{ type: "string", value: "$workers.scriptName" }],
          },
        }),
      },
    );
    // `value` is scaled up by the sampling rate; what is stored is value / interval.
    return Object.fromEntries(
      (result.calculations?.[0]?.aggregates ?? []).map((row) => [
        row.groupKey,
        row.value / (row.sampleInterval || 1),
      ]),
    );
  } catch (error) {
    problems.push(`logs: ${error.message}`);
    return {};
  }
}

/** Names for container applications and Durable Object namespaces. */
async function names() {
  const found = {};
  const read = async (path, label) => {
    try {
      for (const entry of await rest(path)) found[entry.id] = label(entry);
    } catch (error) {
      problems.push(`names: ${error.message}`);
    }
  };
  await Promise.all([
    read(`/accounts/${ACCOUNT}/containers/applications`, (app) => app.name),
    read(
      `/accounts/${ACCOUNT}/workers/durable_objects/namespaces`,
      (namespace) => `${namespace.script}: ${namespace.class}`,
    ),
  ]);
  return found;
}

const named = await names();
// --site: leave out test and staging Workers (and their containers, Durable
// Objects, buckets and logs), which are billed but are not the site's cost.
const SITE_ONLY = flag("--site");
const NOT_THE_SITE = /staging|perf|test|egress|xreq/;
// A deleted container application or Durable Object class keeps its id and
// loses its name; tonight every deleted one was a test.
const DELETED =
  /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/;
const counted = (name) =>
  !SITE_ONLY ||
  !(
    NOT_THE_SITE.test(named[name] ?? name) ||
    (!named[name] && DELETED.test(name))
  );

// One visitor request runs several Workers: `gitdiagram-edge` (holds the
// routes; answers cached pages), then `gitdiagram` (routing, page cache),
// then `gitdiagram-server` or `gitdiagram-server-local` (Next.js), and the
// Tail Worker `gitdiagram-errors` after each. Cloudflare bills the request
// once, at the Worker the visitor reached, and CPU for all of them; analytics
// counts every run. A Worker under an hour old shows as `__unknown__`.
const SITE_FAMILY =
  /^(?:gitdiagram(?:-edge|-server|-server-local|-errors)?|__unknown__)$/;
/** Requests billed for the site: runs of whichever Worker faced visitors. */
const siteBilledRequests = (runsByWorker) =>
  Math.max(runsByWorker["gitdiagram-edge"] ?? 0, runsByWorker.gitdiagram ?? 0);

/** Everything billed by use between two moments. */
async function usage(from, to) {
  let [workers, doCalls, doTime, r2Ops, containers, logs] = await Promise.all([
    dataset(
      "workersInvocationsAdaptive",
      "sum{requests cpuTimeUs} dimensions{scriptName}",
      from,
      to,
    ),
    dataset(
      "durableObjectsInvocationsAdaptiveGroups",
      "sum{requests} dimensions{namespaceId}",
      from,
      to,
    ),
    dataset(
      "durableObjectsPeriodicGroups",
      "sum{duration rowsRead rowsWritten} dimensions{namespaceId}",
      from,
      to,
    ),
    dataset(
      "r2OperationsAdaptiveGroups",
      "sum{requests} dimensions{bucketName actionType}",
      from,
      to,
    ),
    dataset(
      "containersUsageAdaptiveGroups",
      "sum{cpuTimeSec allocatedMemory allocatedDisk} dimensions{applicationId}",
      from,
      to,
    ),
    logEvents(from, to),
  ]);
  const keep = (rows, key) =>
    rows.filter((row) => counted(row.dimensions[key]));
  workers = keep(workers, "scriptName");
  doCalls = keep(doCalls, "namespaceId");
  doTime = keep(doTime, "namespaceId");
  r2Ops = keep(r2Ops, "bucketName");
  containers = keep(containers, "applicationId");
  for (const name of Object.keys(logs)) if (!counted(name)) delete logs[name];
  const by = (rows, key, pick) => {
    const out = {};
    for (const row of rows)
      out[row.dimensions[key]] = (out[row.dimensions[key]] ?? 0) + pick(row);
    return out;
  };
  const classA = r2Ops.filter((row) =>
    R2_CLASS_A.test(row.dimensions.actionType),
  );
  const classB = r2Ops.filter(
    (row) =>
      !R2_CLASS_A.test(row.dimensions.actionType) &&
      !R2_FREE.test(row.dimensions.actionType),
  );
  const runs = by(workers, "scriptName", (row) => row.sum.requests);
  return {
    totals: {
      workerRequests:
        siteBilledRequests(runs) +
        sum(
          workers.filter((row) => !SITE_FAMILY.test(row.dimensions.scriptName)),
          (row) => row.sum.requests,
        ),
      workerCpuMs: sum(workers, (row) => row.sum.cpuTimeUs) / 1000,
      doRequests: sum(doCalls, (row) => row.sum.requests),
      doDurationGbS: sum(doTime, (row) => row.sum.duration),
      doRowsRead: sum(doTime, (row) => row.sum.rowsRead),
      doRowsWritten: sum(doTime, (row) => row.sum.rowsWritten),
      r2ClassA: sum(classA, (row) => row.sum.requests),
      r2ClassB: sum(classB, (row) => row.sum.requests),
      containerCpuS: sum(containers, (row) => row.sum.cpuTimeSec),
      containerMemGibS: sum(containers, (row) => row.sum.allocatedMemory) / GIB,
      containerDiskGbS: sum(containers, (row) => row.sum.allocatedDisk) / 1e9,
      logEvents: sum(Object.values(logs), (count) => count),
    },
    detail: {
      requestsByWorker: by(workers, "scriptName", (row) => row.sum.requests),
      cpuMsByWorker: by(
        workers,
        "scriptName",
        (row) => row.sum.cpuTimeUs / 1000,
      ),
      doRequestsByNamespace: by(
        doCalls,
        "namespaceId",
        (row) => row.sum.requests,
      ),
      r2ClassAByBucket: by(classA, "bucketName", (row) => row.sum.requests),
      r2ClassBByBucket: by(classB, "bucketName", (row) => row.sum.requests),
      logEventsByWorker: logs,
      containerCpuSByApplication: by(
        containers,
        "applicationId",
        (row) => row.sum.cpuTimeSec,
      ),
      containerMemGibSByApplication: by(
        containers,
        "applicationId",
        (row) => row.sum.allocatedMemory / GIB,
      ),
      doDurationGbSByNamespace: by(
        doTime,
        "namespaceId",
        (row) => row.sum.duration,
      ),
    },
  };
}

/** Bytes stored in R2 now, all buckets. */
async function storageGb(now) {
  const rows = await dataset(
    "r2StorageAdaptiveGroups",
    "max{payloadSize metadataSize} dimensions{bucketName}",
    now - 36 * 3600_000,
    now,
  );
  const perBucket = {};
  for (const row of rows.filter((entry) =>
    counted(entry.dimensions.bucketName),
  ))
    perBucket[row.dimensions.bucketName] =
      (row.max.payloadSize + row.max.metadataSize) / 1e9;
  return perBucket;
}

const cost = (line, used) =>
  (Math.max(0, used - PRICES[line].included) / PRICES[line].per) *
  PRICES[line].price;

function priced(totals) {
  const lines = Object.keys(PRICES).map((line) => ({
    line,
    used: totals[line] ?? 0,
    cost: cost(line, totals[line] ?? 0),
  }));
  return {
    lines,
    total: WORKERS_PAID + sum(lines, (line) => line.cost),
  };
}

const number = (value) =>
  value >= 100
    ? Math.round(value).toLocaleString("en-US")
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const money = (value) => `$${value.toFixed(2)}`;

function table(title, result) {
  console.log(`\n${title}`);
  const rows = [
    ["Line", "Used", "Included", "Price", "Cost"],
    ["Workers Paid plan", "", "", "flat", money(WORKERS_PAID)],
    ...result.lines.map(({ line, used, cost: lineCost }) => [
      LABELS[line],
      number(used),
      number(PRICES[line].included),
      `$${PRICES[line].price} per ${number(PRICES[line].per)}`,
      money(lineCost),
    ]),
    ["Total", "", "", "", money(result.total)],
  ];
  const widths = rows[0].map((_, column) =>
    Math.max(...rows.map((row) => row[column].length)),
  );
  for (const row of rows)
    console.log(
      "  " +
        row
          .map((cell, column) =>
            column === 0
              ? cell.padEnd(widths[column])
              : cell.padStart(widths[column]),
          )
          .join("  "),
    );
}

async function billingPeriod(now) {
  try {
    const subscriptions = await rest(`/accounts/${ACCOUNT}/subscriptions`);
    const paid = subscriptions.find(
      (entry) => entry.rate_plan?.id === "workers_paid",
    );
    if (paid)
      return {
        start: Date.parse(paid.current_period_start),
        end: Date.parse(paid.current_period_end),
      };
  } catch (error) {
    problems.push(`subscriptions: ${error.message}`);
  }
  const start = new Date(now);
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return { start: start.getTime(), end: start.getTime() + 30 * 86_400_000 };
}

/** What Cloudflare's own billing has charged for use so far (lags by a day). */
async function billed() {
  try {
    const rows = await rest(`/accounts/${ACCOUNT}/paygo-usage`);
    const services = {};
    for (const row of rows) {
      const entry = (services[row.ServiceName] ??= { used: 0, cost: 0 });
      entry.used += row.ConsumedQuantity ?? 0;
      entry.cost += row.BilledCost ?? 0;
    }
    const through = rows
      .map((row) => row.ChargePeriodEnd)
      .sort()
      .at(-1);
    return { services, through };
  } catch (error) {
    problems.push(`billing: ${error.message}`);
    return null;
  }
}

const now = Date.now();
const period = await billingPeriod(now);
const hours = Number(option("--hours", "24"));
// The cost watch looks at the whole window whatever happened in it: a short
// window would turn one test burst into a month's alarm.
const windowStart = option("--fail-above")
  ? now - hours * 3600_000
  : Math.max(now - hours * 3600_000, LIVE_SINCE);
const windowHours = (now - windowStart) / 3600_000;

const [toDate, recent, buckets, charged] = await Promise.all([
  usage(period.start, now),
  usage(windowStart, now),
  storageGb(now),
  billed(),
]);

const storedGb = sum(Object.values(buckets), (gb) => gb);
toDate.totals.r2StorageGb =
  (storedGb * (now - period.start)) / (period.end - period.start);
const scale = MONTH_HOURS / windowHours;
const monthly = Object.fromEntries(
  Object.entries(recent.totals).map(([line, used]) => [line, used * scale]),
);
monthly.r2StorageGb = storedGb;

const soFar = priced(toDate.totals);
const projected = priced(monthly);
const siteRequests = siteBilledRequests(recent.detail.requestsByWorker);
const siteCpuMs = sum(
  Object.entries(recent.detail.cpuMsByWorker).filter(([worker]) =>
    SITE_FAMILY.test(worker),
  ),
  ([, ms]) => ms,
);

const ceiling = Number(option("--fail-above", "0"));
if (ceiling > 0) {
  // The watch must not pass because it could not see.
  if (problems.some((problem) => problem.startsWith("workers"))) {
    console.log(`Cost watch could not read usage: ${problems.join("; ")}`);
    process.exit(2);
  }
  const over = projected.total > ceiling;
  const worst = [...projected.lines].sort((a, b) => b.cost - a.cost)[0];
  console.log(
    `A month at the pace of the last ${windowHours.toFixed(1)} h would cost ${money(projected.total)} ` +
      `(alarm above ${money(ceiling)}; largest line: ${LABELS[worst.line]}, ${money(worst.cost)}; ` +
      `${number(siteRequests / windowHours)} site requests an hour).`,
  );
  if (over)
    console.log(
      "Over the ceiling: run `bun run cf:usage --hours 2` for the table, and see CLAUDE.md (Cloudflare, Cost).",
    );
  process.exit(over ? 1 : 0);
} else if (flag("--json")) {
  console.log(
    JSON.stringify(
      {
        at: iso(now),
        period: { start: iso(period.start), end: iso(period.end) },
        toDate: { ...toDate, cost: soFar },
        window: { start: iso(windowStart), hours: windowHours, ...recent },
        projectedMonth: { usage: monthly, cost: projected },
        storageGbByBucket: buckets,
        billed: charged,
        vercelMonthly: VERCEL_MONTHLY,
        problems,
      },
      null,
      2,
    ),
  );
} else {
  if (SITE_ONLY)
    console.log("Site only: test and staging Workers are left out.");
  console.log(
    `Cloudflare usage for account ${ACCOUNT.slice(0, 8)}…, ${iso(now)}`,
  );
  table(
    `Billing period so far (${iso(period.start).slice(0, 10)} to ${iso(period.end).slice(0, 10)}), measured:`,
    soFar,
  );
  table(
    `A month at the pace of the last ${windowHours.toFixed(1)} h (estimate: ${iso(windowStart)} to now, x${scale.toFixed(1)}):`,
    projected,
  );
  console.log(
    `\n  Site Worker in that window: ${number(siteRequests)} requests, ${number(siteRequests / windowHours)} an hour, ` +
      `${siteRequests ? (siteCpuMs / siteRequests).toFixed(1) : "0"} ms CPU a request.`,
  );
  console.log(
    `  Vercel's last bill: ${money(VERCEL_MONTHLY)}. Projected Cloudflare: ${money(projected.total)} ` +
      `(${projected.total < VERCEL_MONTHLY ? "cheaper by" : "DEARER by"} ${money(Math.abs(VERCEL_MONTHLY - projected.total))}).`,
  );
  if (windowHours < 20)
    console.log(
      "  The window is under a day, so it misses part of the daily cycle; treat the projection as rough.",
    );
  const detail = (title, values, unit = "") => {
    const entries = Object.entries(values).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return;
    console.log(`\n  ${title}`);
    for (const [name, value] of entries)
      console.log(
        `    ${(named[name] ?? (name || "(deleted)")).padEnd(50)} ${number(value)}${unit}`,
      );
  };
  detail(
    "Runs by Worker (window; a visitor's request is billed once, see SITE_FAMILY):",
    recent.detail.requestsByWorker,
  );
  detail("CPU by Worker (window):", recent.detail.cpuMsByWorker, " ms");
  detail("R2 class A by bucket (window):", recent.detail.r2ClassAByBucket);
  detail("R2 class B by bucket (window):", recent.detail.r2ClassBByBucket);
  detail("R2 storage by bucket (now):", buckets, " GB");
  detail(
    "Durable Object requests by class (window):",
    recent.detail.doRequestsByNamespace,
  );
  detail(
    "Durable Object duration by class (window):",
    recent.detail.doDurationGbSByNamespace,
    " GB-s",
  );
  detail(
    "Container CPU by application (window):",
    recent.detail.containerCpuSByApplication,
    " vCPU-s",
  );
  detail(
    "Container memory by application (window):",
    recent.detail.containerMemGibSByApplication,
    " GiB-s",
  );
  detail(
    "Stored log events by Worker (window):",
    recent.detail.logEventsByWorker,
  );
  if (charged) {
    console.log(
      `\n  Cloudflare's billing API, charged so far (through ${charged.through?.slice(0, 10) ?? "?"}; it lags about a day):`,
    );
    for (const [name, entry] of Object.entries(charged.services))
      console.log(
        `    ${name.padEnd(56)} ${number(entry.used).padStart(12)}  ${money(entry.cost)}`,
      );
  }
  if (problems.length)
    console.log(`\n  Could not read: ${problems.join("; ")}`);
}
