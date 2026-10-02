#!/usr/bin/env node
// What Cloudflare has cost so far this billing period, and what a month at
// the current traffic would cost.
//
//   node scripts/cf-usage.mjs               period to date + projection from the last 24 h
//   node scripts/cf-usage.mjs --hours 6     project from the last 6 hours instead
//   node scripts/cf-usage.mjs --json        the same numbers as JSON
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

/** Everything billed by use between two moments. */
async function usage(from, to) {
  const [workers, doCalls, doTime, r2Ops, containers, logs] = await Promise.all(
    [
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
    ],
  );
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
  return {
    totals: {
      workerRequests: sum(workers, (row) => row.sum.requests),
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
  for (const row of rows)
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
const windowStart = Math.max(now - hours * 3600_000, LIVE_SINCE);
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
const siteRequests = recent.detail.requestsByWorker.gitdiagram ?? 0;
const siteCpuMs = recent.detail.cpuMsByWorker.gitdiagram ?? 0;

if (flag("--json")) {
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
      console.log(`    ${name.padEnd(44)} ${number(value)}${unit}`);
  };
  detail("Requests by Worker (window):", recent.detail.requestsByWorker);
  detail("R2 class A by bucket (window):", recent.detail.r2ClassAByBucket);
  detail("R2 class B by bucket (window):", recent.detail.r2ClassBByBucket);
  detail("R2 storage by bucket (now):", buckets, " GB");
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
