import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function parseArgs(argv) {
  const parsed = {
    batchSize: 2000,
    concurrency: 8,
    maxBatches: Infinity,
    stateFile: ".cache/backfill-public-cache-state.json",
    startCursor: undefined,
    dryRun: false,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg.startsWith("--batch-size=")) {
      parsed.batchSize =
        Number.parseInt(arg.slice("--batch-size=".length), 10) || parsed.batchSize;
      continue;
    }
    if (arg.startsWith("--concurrency=")) {
      parsed.concurrency =
        Number.parseInt(arg.slice("--concurrency=".length), 10) || parsed.concurrency;
      continue;
    }
    if (arg.startsWith("--max-batches=")) {
      const value = Number.parseInt(arg.slice("--max-batches=".length), 10);
      parsed.maxBatches = Number.isFinite(value) && value > 0 ? value : parsed.maxBatches;
      continue;
    }
    if (arg.startsWith("--state-file=")) {
      parsed.stateFile = arg.slice("--state-file=".length) || parsed.stateFile;
      continue;
    }
    if (arg.startsWith("--cursor=")) {
      parsed.startCursor = arg.slice("--cursor=".length) || undefined;
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

function saveState(stateFile, payload) {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function extractSummary(stdout) {
  const lines = stdout.split(/\r?\n/);
  const summary = {
    skipReasons: {},
  };
  const readValue = (line, prefix) => line.slice(prefix.length).trim();

  for (const line of lines) {
    if (line.startsWith("Processed:")) {
      summary.processed = Number.parseInt(readValue(line, "Processed:").replaceAll(",", ""), 10);
    } else if (line.startsWith("Uploaded:")) {
      summary.uploaded = Number.parseInt(readValue(line, "Uploaded:").replaceAll(",", ""), 10);
    } else if (line.startsWith("Skipped:")) {
      summary.skipped = Number.parseInt(readValue(line, "Skipped:").replaceAll(",", ""), 10);
    } else if (line.startsWith("Errors:")) {
      summary.errors = Number.parseInt(readValue(line, "Errors:").replaceAll(",", ""), 10);
    } else if (line.startsWith("Next cursor:")) {
      summary.nextCursor = readValue(line, "Next cursor:") || null;
    } else if (line.startsWith("Rate limited:")) {
      summary.rateLimited = readValue(line, "Rate limited:") === "yes";
    } else if (line.startsWith("Rate reset at:")) {
      summary.rateResetAt = readValue(line, "Rate reset at:") || null;
    } else if (line.startsWith("Retry after:")) {
      summary.retryAfter = Number.parseInt(readValue(line, "Retry after:"), 10);
    } else if (line.startsWith("Skip ")) {
      const match = /^Skip\s+(.+?):\s+([\d,]+)$/.exec(line.trim());
      if (match) {
        summary.skipReasons[match[1]] = Number.parseInt(
          match[2].replaceAll(",", ""),
          10,
        );
      }
    }
  }

  return summary;
}

function mergeCounts(base = {}, delta = {}) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(delta)) {
    merged[key] = (merged[key] ?? 0) + value;
  }
  return merged;
}

const args = parseArgs(process.argv.slice(2));
const stateFile = resolve(args.stateFile);
const existingState = loadState(stateFile);
let cursor = args.startCursor ?? existingState?.nextCursor;
let totalProcessed = existingState?.totals?.processed ?? 0;
let totalUploaded = existingState?.totals?.uploaded ?? 0;
let totalSkipped = existingState?.totals?.skipped ?? 0;
let totalErrors = existingState?.totals?.errors ?? 0;
let totalSkipReasons = existingState?.totals?.skipReasons ?? {};

for (let batchNumber = 1; batchNumber <= args.maxBatches; batchNumber += 1) {
  const commandArgs = [
    "scripts/backfill-public-cache-to-r2.mjs",
    `--limit=${args.batchSize}`,
    `--concurrency=${args.concurrency}`,
  ];

  if (cursor) {
    commandArgs.push(`--cursor=${cursor}`);
  }
  if (args.dryRun) {
    commandArgs.push("--dry-run");
  }

  console.log(
    `batch=${batchNumber} cursor=${cursor ?? "<start>"} size=${args.batchSize} concurrency=${args.concurrency}`,
  );

  const result = spawnSync("node", commandArgs, {
    stdio: "pipe",
    encoding: "utf8",
    env: process.env,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    const summary = extractSummary(result.stdout ?? "");
    if (summary.rateLimited) {
      saveState(stateFile, {
        updatedAt: new Date().toISOString(),
        batchNumber,
        nextCursor: summary.nextCursor ?? cursor ?? null,
        haltedReason: "github_rate_limit",
        lastBatch: summary,
        totals: {
          processed: totalProcessed + (summary.processed ?? 0),
          uploaded: totalUploaded + (summary.uploaded ?? 0),
          skipped: totalSkipped + (summary.skipped ?? 0),
          errors: totalErrors + (summary.errors ?? 0),
          skipReasons: mergeCounts(totalSkipReasons, summary.skipReasons),
        },
      });
      console.log("Backfill paused for GitHub rate limit.");
      break;
    }

    throw new Error(`Backfill batch ${batchNumber} failed with exit code ${result.status ?? "unknown"}.`);
  }

  const summary = extractSummary(result.stdout ?? "");
  totalProcessed += summary.processed ?? 0;
  totalUploaded += summary.uploaded ?? 0;
  totalSkipped += summary.skipped ?? 0;
  totalErrors += summary.errors ?? 0;
  totalSkipReasons = mergeCounts(totalSkipReasons, summary.skipReasons);

  saveState(stateFile, {
    updatedAt: new Date().toISOString(),
    batchNumber,
    nextCursor: summary.nextCursor ?? null,
    haltedReason: summary.rateLimited ? "github_rate_limit" : null,
    rateResetAt: summary.rateResetAt ?? null,
    retryAfter: summary.retryAfter ?? null,
    lastBatch: summary,
    totals: {
      processed: totalProcessed,
      uploaded: totalUploaded,
      skipped: totalSkipped,
      errors: totalErrors,
      skipReasons: totalSkipReasons,
    },
  });

  if (!summary.nextCursor || (summary.processed ?? 0) === 0) {
    console.log("Backfill exhausted.");
    break;
  }

  if (summary.rateLimited) {
    console.log("Backfill paused for GitHub rate limit.");
    break;
  }

  cursor = summary.nextCursor;
}
