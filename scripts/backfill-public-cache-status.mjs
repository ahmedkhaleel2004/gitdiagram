import { config } from "dotenv";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

config({ path: ".env" });

function parseArgs(argv) {
  const parsed = {
    stateFile: "/tmp/gitdiagram-backfill-state.json",
  };

  for (const arg of argv) {
    if (arg.startsWith("--state-file=")) {
      parsed.stateFile = arg.slice("--state-file=".length) || parsed.stateFile;
    }
  }

  return parsed;
}

function loadState(stateFile) {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

function readEnv(name) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readEnvList(name) {
  const value = readEnv(name);
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0s";
  }

  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours) {
    parts.push(`${hours}h`);
  }
  if (minutes) {
    parts.push(`${minutes}m`);
  }
  if (seconds && !hours) {
    parts.push(`${seconds}s`);
  }
  return parts.join(" ");
}

function getProcessSummary() {
  try {
    return execSync(
      "ps -Ao pid,etime,command | rg 'backfill-public-cache-daemon|caffeinate -dimsu' -n -S",
      { encoding: "utf8" },
    ).trim();
  } catch {
    return "";
  }
}

const args = parseArgs(process.argv.slice(2));
const state = loadState(resolve(args.stateFile));
const databaseUrl = process.env.POSTGRES_URL?.trim();

let totalCandidates = null;
if (databaseUrl) {
  const sql = postgres(databaseUrl);
  const rows = await sql.unsafe(
    "select count(*)::int as count from gitdiagram_diagram_cache where coalesce(diagram, '') <> ''",
  );
  totalCandidates = rows[0]?.count ?? null;
  await sql.end();
}

const processed = state?.totals?.processed ?? 0;
const uploaded = state?.totals?.uploaded ?? 0;
const skipped = state?.totals?.skipped ?? 0;
const errors = state?.totals?.errors ?? 0;
const totalSkipReasons = state?.totals?.skipReasons ?? {};
const lastBatchSkipReasons = state?.lastBatch?.skipReasons ?? {};
const remaining = totalCandidates === null ? null : Math.max(totalCandidates - processed, 0);
const rowsPerHour = 5000;
const etaMs = remaining === null ? null : (remaining / rowsPerHour) * 60 * 60 * 1000;
const authSourceCount =
  (readEnv("GITHUB_CLIENT_ID") && readEnv("GITHUB_PRIVATE_KEY") && readEnv("GITHUB_INSTALLATION_ID")
    ? 1
    : 0) +
  (readEnv("GITHUB_PAT") ? 1 : 0) +
  readEnvList("GITHUB_PATS").length;
const maxRowsPerHour = Math.max(authSourceCount, 1) * rowsPerHour;
const maxEtaMs = remaining === null ? null : (remaining / maxRowsPerHour) * 60 * 60 * 1000;
const resetAt = state?.rateResetAt ? new Date(state.rateResetAt) : null;
const resetInMs = resetAt ? resetAt.getTime() - Date.now() : null;

console.log(`state_file=${resolve(args.stateFile)}`);
console.log(`daemon=${getProcessSummary() ? "running" : "not_running"}`);
if (getProcessSummary()) {
  console.log(getProcessSummary());
}
console.log(`cursor=${state?.nextCursor ?? "unknown"}`);
console.log(`halted_reason=${state?.haltedReason ?? "none"}`);
console.log(`updated_at=${state?.updatedAt ?? "unknown"}`);
console.log(`processed=${processed}`);
console.log(`uploaded=${uploaded}`);
console.log(`skipped=${skipped}`);
console.log(`errors=${errors}`);
for (const [reason, count] of Object.entries(totalSkipReasons)) {
  console.log(`skip_total_${reason}=${count}`);
}
for (const [reason, count] of Object.entries(lastBatchSkipReasons)) {
  console.log(`skip_last_batch_${reason}=${count}`);
}
if (totalCandidates !== null) {
  console.log(`total_candidates=${totalCandidates}`);
  console.log(`remaining_candidates=${remaining}`);
  console.log(`progress=${((processed / totalCandidates) * 100).toFixed(2)}%`);
  console.log(`rough_eta_single_bucket=${formatDuration(etaMs)}`);
  console.log(`auth_source_count=${authSourceCount}`);
  console.log(`max_auth_limited_rate_per_hour=${maxRowsPerHour}`);
  console.log(`rough_eta_max_capacity=${formatDuration(maxEtaMs)}`);
}
if (resetAt) {
  console.log(`github_rate_reset_at=${resetAt.toISOString()}`);
  console.log(`github_rate_reset_in=${formatDuration(resetInMs)}`);
}
