import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseArgs(argv) {
  const parsed = {
    batchSize: 2000,
    concurrency: 8,
    maxBatchesPerRun: 3,
    stateFile: ".cache/backfill-public-cache-state.json",
    startCursor: undefined,
  };

  for (const arg of argv) {
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
    if (arg.startsWith("--max-batches-per-run=")) {
      parsed.maxBatchesPerRun =
        Number.parseInt(arg.slice("--max-batches-per-run=".length), 10) ||
        parsed.maxBatchesPerRun;
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

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

const args = parseArgs(process.argv.slice(2));
const stateFile = resolve(args.stateFile);
let cursor = args.startCursor;

for (;;) {
  const commandArgs = [
    "scripts/backfill-public-cache-loop.mjs",
    `--batch-size=${args.batchSize}`,
    `--concurrency=${args.concurrency}`,
    `--max-batches=${args.maxBatchesPerRun}`,
    `--state-file=${stateFile}`,
  ];
  if (cursor) {
    commandArgs.push(`--cursor=${cursor}`);
  }

  const result = spawnSync("node", commandArgs, {
    stdio: "inherit",
    env: process.env,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`Backfill daemon failed with exit code ${result.status ?? "unknown"}.`);
  }

  const state = loadState(stateFile);
  if (!state?.nextCursor) {
    console.log("Backfill daemon exhausted.");
    break;
  }

  cursor = state.nextCursor;

  if (state.haltedReason !== "github_rate_limit" || !state.rateResetAt) {
    console.log(`Backfill daemon continuing from ${state.nextCursor}.`);
    continue;
  }

  const waitMs = Math.max(new Date(state.rateResetAt).getTime() - Date.now() + 5_000, 5_000);
  console.log(`Backfill daemon sleeping until ${state.rateResetAt} (${Math.ceil(waitMs / 1000)}s).`);
  await sleep(waitMs);
}
