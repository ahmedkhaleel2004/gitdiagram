import { createRequire } from "node:module";
import { createSign } from "node:crypto";

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config } from "dotenv";
import DOMPurify from "dompurify";
import postgres from "postgres";

config({ path: ".env" });

const require = createRequire(import.meta.url);

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

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    limit: 250,
    cursor: undefined,
    concurrency: 4,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      parsed.limit = Number.parseInt(arg.slice("--limit=".length), 10) || parsed.limit;
      continue;
    }
    if (arg.startsWith("--cursor=")) {
      parsed.cursor = arg.slice("--cursor=".length) || undefined;
      continue;
    }
    if (arg.startsWith("--concurrency=")) {
      parsed.concurrency =
        Number.parseInt(arg.slice("--concurrency=".length), 10) || parsed.concurrency;
    }
  }

  return parsed;
}

function getS3Client() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${readEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: readEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: readEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
}

function normalizeSegment(value) {
  return encodeURIComponent(value.trim().toLowerCase());
}

function artifactKey(username, repo) {
  return `public/v1/${normalizeSegment(username)}/${normalizeSegment(repo)}.json`;
}

function normalizeTimestamp(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function buildLegacySessionSummary(row) {
  const timestamp =
    normalizeTimestamp(row.lastSuccessfulAt) ??
    normalizeTimestamp(row.updatedAt) ??
    normalizeTimestamp(row.createdAt) ??
    new Date().toISOString();

  return {
    sessionId: `legacy:${row.username}/${row.repo}`,
    status: "succeeded",
    stage: "complete",
    provider: row.latestSessionProvider ?? "legacy",
    model: row.latestSessionModel ?? "legacy",
    graph: row.graph ?? null,
    graphAttempts: [],
    stageUsages: [],
    timeline: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function toStoredSessionSummary(audit) {
  if (!audit) {
    return null;
  }

  return {
    sessionId: audit.sessionId,
    status: audit.status,
    stage: audit.stage,
    provider: audit.provider,
    model: audit.model,
    quotaStatus: audit.quotaStatus,
    quotaBucket: audit.quotaBucket,
    quotaDateUtc: audit.quotaDateUtc,
    reservedTokens: audit.reservedTokens,
    actualCommittedTokens: audit.actualCommittedTokens,
    quotaResetAt: audit.quotaResetAt,
    estimatedCost: audit.estimatedCost,
    finalCost: audit.finalCost,
    graph: audit.graph ?? null,
    graphAttempts: audit.status === "failed" ? audit.graphAttempts ?? [] : [],
    stageUsages: [],
    validationError: audit.validationError,
    failureStage: audit.failureStage,
    compilerError: audit.compilerError,
    renderError: audit.renderError,
    timeline: [],
    createdAt: audit.createdAt,
    updatedAt: audit.updatedAt,
  };
}

function getStoredSessionSummary(row) {
  return toStoredSessionSummary(row.latestSessionAudit) ?? buildLegacySessionSummary(row);
}

function getArtifactTimestamp(row) {
  return (
    normalizeTimestamp(row.lastSuccessfulAt) ??
    normalizeTimestamp(row.updatedAt) ??
    normalizeTimestamp(row.createdAt)
  );
}

class GithubRateLimitError extends Error {
  constructor({ username, repo, resetAt, retryAfter, message, authSource }) {
    super(message);
    this.name = "GithubRateLimitError";
    this.username = username;
    this.repo = repo;
    this.resetAt = resetAt ?? null;
    this.retryAfter = retryAfter ?? null;
    this.authSource = authSource ?? "unknown";
  }
}

const githubAuthCooldowns = new Map();

function getAuthCooldown(source) {
  const cooldown = githubAuthCooldowns.get(source);
  if (!cooldown) {
    return null;
  }
  if (cooldown.until <= Date.now()) {
    githubAuthCooldowns.delete(source);
    return null;
  }
  return cooldown;
}

function setAuthCooldown(source, error) {
  if (!source || source === "unknown") {
    return;
  }

  const resetMs = error.resetAt ? new Date(error.resetAt).getTime() : null;
  const retryAfterMs =
    typeof error.retryAfter === "number" && Number.isFinite(error.retryAfter)
      ? Date.now() + error.retryAfter * 1000
      : null;
  const until = Math.max(resetMs ?? 0, retryAfterMs ?? 0, Date.now() + 60_000);
  githubAuthCooldowns.set(source, {
    until,
    resetAt: error.resetAt ?? (until ? new Date(until).toISOString() : null),
    retryAfter: error.retryAfter ?? null,
  });
}

let mermaidInstance = null;
let mermaidInitialized = false;
let domPurifyPatched = false;

function ensureDomPurifyPatched() {
  if (domPurifyPatched) {
    return;
  }

  try {
    const domPurify = DOMPurify;
    if (typeof domPurify === "function" && typeof domPurify.sanitize !== "function") {
      const { JSDOM } = require("jsdom");
      const domWindow = new JSDOM("<!doctype html><html><body></body></html>").window;
      const domPurifyInstance = domPurify(domWindow);
      Object.assign(domPurify, domPurifyInstance);
    }
  } catch {
    // Best effort patch.
  } finally {
    domPurifyPatched = true;
  }
}

async function getMermaid() {
  if (mermaidInstance) {
    return mermaidInstance;
  }

  ensureDomPurifyPatched();
  const mermaidModule = await import("mermaid");
  mermaidInstance = mermaidModule.default;
  return mermaidInstance;
}

async function validateMermaidSyntax(diagram) {
  const mermaid = await getMermaid();
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
    });
    mermaidInitialized = true;
  }

  try {
    await mermaid.parse(diagram);
    return true;
  } catch {
    return false;
  }
}

async function fetchRepoMetadataWithHeaders(username, repo, headers, authSource) {
  const response = await fetch(`https://api.github.com/repos/${username}/${repo}`, {
    headers,
    cache: "no-store",
  });
  let responseText = null;

  if (response.status === 404) {
    return null;
  }
  if (response.status === 403 || response.status === 429) {
    responseText = await response.text();
    const lowerText = responseText.toLowerCase();
    const resetHeader = response.headers.get("x-ratelimit-reset");
    const retryAfter = response.headers.get("retry-after");
    if (
      lowerText.includes("rate limit") ||
      response.headers.get("x-ratelimit-remaining") === "0" ||
      retryAfter
    ) {
      throw new GithubRateLimitError({
        username,
        repo,
        resetAt: resetHeader
          ? new Date(Number.parseInt(resetHeader, 10) * 1000).toISOString()
          : null,
        retryAfter: retryAfter ? Number.parseInt(retryAfter, 10) : null,
        message: `GitHub repo lookup rate limited for ${username}/${repo} via ${authSource} (${response.status})`,
        authSource,
      });
    }
  }
  if (!response.ok) {
    responseText ??= await response.text();
    throw new Error(
      `GitHub repo lookup failed for ${username}/${repo} (${response.status}): ${responseText}`,
    );
  }

  return response.json();
}

async function fetchRepoMetadata(username, repo, githubPat) {
  const authAttempts = await createGithubAuthAttempts(githubPat);
  let rateLimitError = null;

  for (const attempt of authAttempts) {
    try {
      return await fetchRepoMetadataWithHeaders(
        username,
        repo,
        attempt.headers,
        attempt.source,
      );
    } catch (error) {
      if (error instanceof GithubRateLimitError) {
        setAuthCooldown(attempt.source, error);
        rateLimitError ??= error;
        continue;
      }
      throw error;
    }
  }

  if (rateLimitError) {
    throw rateLimitError;
  }

  throw new Error(`GitHub repo lookup could not be authenticated for ${username}/${repo}.`);
}

let githubInstallationToken = null;
let githubInstallationTokenExpiresAt = 0;

function createGithubJwt() {
  const clientId = readEnv("GITHUB_CLIENT_ID");
  const privateKey = readEnv("GITHUB_PRIVATE_KEY")?.replace(/\\n/g, "\n");

  if (!clientId || !privateKey) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iat: now,
      exp: now + 10 * 60,
      iss: clientId,
    }),
  ).toString("base64url");

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = signer.sign(privateKey, "base64url");
  return `${header}.${payload}.${signature}`;
}

async function getGithubInstallationToken() {
  if (
    githubInstallationToken &&
    githubInstallationTokenExpiresAt > Date.now() + 60_000
  ) {
    return githubInstallationToken;
  }

  const installationId = readEnv("GITHUB_INSTALLATION_ID");
  const jwt = createGithubJwt();
  if (!installationId || !jwt) {
    return null;
  }

  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `GitHub installation token request failed (${response.status}): ${await response.text()}`,
    );
  }

  const payload = await response.json();
  githubInstallationToken = payload.token ?? null;
  githubInstallationTokenExpiresAt = payload.expires_at
    ? new Date(payload.expires_at).getTime()
    : Date.now() + 50 * 60 * 1000;
  return githubInstallationToken;
}

function getGithubPersonalAccessTokens() {
  const tokens = [];
  const seen = new Set();

  for (const token of [readEnv("GITHUB_PAT"), ...readEnvList("GITHUB_PATS")]) {
    if (!token || seen.has(token)) {
      continue;
    }
    seen.add(token);
    tokens.push(token);
  }

  return tokens;
}

async function createGithubAuthAttempts(githubPat) {
  const attempts = [];
  const addAttempt = (attempt) => {
    const cooldown = getAuthCooldown(attempt.source);
    if (cooldown) {
      return;
    }
    attempts.push(attempt);
  };
  const installationToken = await getGithubInstallationToken();
  if (installationToken) {
    addAttempt({
      source: "app_installation",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${installationToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  }

  const personalAccessTokens = githubPat
    ? [githubPat, ...getGithubPersonalAccessTokens()]
    : getGithubPersonalAccessTokens();

  for (const [index, token] of personalAccessTokens.entries()) {
    addAttempt({
      source: `personal_access_token_${index + 1}`,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `token ${token}`,
      },
    });
  }

  if (attempts.length === 0) {
    addAttempt({
      source: "unauthenticated",
      headers: {
        Accept: "application/vnd.github+json",
      },
    });
  }

  return attempts;
}

async function getExistingArtifact(client, bucket, key) {
  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
    const body = await response.Body?.transformToString();
    return body ? JSON.parse(body) : null;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "NoSuchKey" ||
        error.name === "NotFound" ||
        error.message.includes("NoSuchKey") ||
        error.message.includes("NotFound"))
    ) {
      return null;
    }
    throw error;
  }
}

async function backfillRow({ row, client, bucket, githubPat, dryRun }) {
  if (!row.diagram) {
    return { status: "skipped", reason: "missing_diagram" };
  }

  const artifactTimestamp = getArtifactTimestamp(row);
  if (!artifactTimestamp) {
    return { status: "skipped", reason: "missing_timestamp" };
  }

  const key = artifactKey(row.username, row.repo);
  const existing = await getExistingArtifact(client, bucket, key);
  if (
    existing?.lastSuccessfulAt &&
    new Date(existing.lastSuccessfulAt).getTime() >=
      new Date(artifactTimestamp).getTime()
  ) {
    return { status: "skipped", reason: "newer_object_exists" };
  }

  const mermaidValid = await validateMermaidSyntax(row.diagram);
  if (!mermaidValid) {
    return { status: "skipped", reason: "invalid_mermaid" };
  }

  const metadata = await fetchRepoMetadata(row.username, row.repo, githubPat);
  if (!metadata) {
    return { status: "skipped", reason: "repo_not_found" };
  }
  if (metadata.private) {
    return { status: "skipped", reason: "private_repo" };
  }

  const payload = {
    version: 1,
    visibility: "public",
    username: row.username,
    repo: row.repo,
    diagram: row.diagram,
    explanation: row.explanation,
    graph: row.graph,
    generatedAt: artifactTimestamp,
    usedOwnKey: Boolean(row.usedOwnKey),
    latestSessionSummary: getStoredSessionSummary(row),
    lastSuccessfulAt: artifactTimestamp,
  };

  if (!dryRun) {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(payload),
        ContentType: "application/json",
      }),
    );
  }

  return { status: "uploaded" };
}

const args = parseArgs(process.argv.slice(2));
const databaseUrl = readEnv("POSTGRES_URL");
const publicBucket = readEnv("R2_PUBLIC_BUCKET");

if (!databaseUrl) {
  throw new Error("Missing POSTGRES_URL.");
}
if (!readEnv("R2_ACCOUNT_ID") || !readEnv("R2_ACCESS_KEY_ID") || !readEnv("R2_SECRET_ACCESS_KEY") || !publicBucket) {
  throw new Error("Missing R2 public bucket configuration.");
}

const githubPat = readEnv("GITHUB_PAT");
const [cursorUsername, cursorRepo] = args.cursor?.split("/") ?? [];

const sql = postgres(databaseUrl);
const rows = await sql.unsafe(
  `
    select
      username,
      repo,
      diagram,
      explanation,
      graph,
      latest_session_status as "latestSessionStatus",
      latest_session_stage as "latestSessionStage",
      latest_session_provider as "latestSessionProvider",
      latest_session_model as "latestSessionModel",
      latest_session_audit as "latestSessionAudit",
      last_successful_at as "lastSuccessfulAt",
      created_at as "createdAt",
      updated_at as "updatedAt",
      used_own_key as "usedOwnKey"
    from gitdiagram_diagram_cache
    where coalesce(diagram, '') <> ''
      and (
        $1::text is null
        or (username, repo) > ($1, $2)
      )
    order by username asc, repo asc
    limit $3
  `,
  [cursorUsername ?? null, cursorRepo ?? null, args.limit],
);

const client = getS3Client();
const summary = {
  uploaded: 0,
  skipped: 0,
  errors: 0,
  reasons: {},
  rateLimited: false,
  rateLimitedAt: null,
  rateLimitedResetAt: null,
  rateLimitedRetryAfter: null,
};

let nextCursor = rows.at(-1)
  ? `${rows.at(-1).username}/${rows.at(-1).repo}`
  : null;

outer: for (let index = 0; index < rows.length; index += args.concurrency) {
  const batch = rows.slice(index, index + args.concurrency);
  nextCursor = `${batch[0].username}/${batch[0].repo}`;
  const results = await Promise.allSettled(
    batch.map((row) =>
      backfillRow({
        row,
        client,
        bucket: publicBucket,
        githubPat,
        dryRun: args.dryRun,
      }),
    ),
  );

  for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
    const row = batch[resultIndex];
    const result = results[resultIndex];

    if (result.status === "rejected") {
      if (result.reason instanceof GithubRateLimitError) {
        summary.rateLimited = true;
        summary.rateLimitedAt = `${result.reason.username}/${result.reason.repo}`;
        summary.rateLimitedResetAt = result.reason.resetAt;
        summary.rateLimitedRetryAfter = result.reason.retryAfter;
        nextCursor = `${result.reason.username}/${result.reason.repo}`;
        console.error(
          `rate_limited ${result.reason.username}/${result.reason.repo} reset_at=${result.reason.resetAt ?? "unknown"} retry_after=${result.reason.retryAfter ?? "unknown"}`,
        );
        break outer;
      }

      summary.errors += 1;
      console.error(`error ${row.username}/${row.repo}:`, result.reason);
      continue;
    }

    if (result.value.status === "uploaded") {
      summary.uploaded += 1;
      console.log(`${args.dryRun ? "would_upload" : "uploaded"} ${row.username}/${row.repo}`);
      continue;
    }

    summary.skipped += 1;
    summary.reasons[result.value.reason] =
      (summary.reasons[result.value.reason] ?? 0) + 1;
  }
}

await sql.end();

const processed = summary.uploaded + summary.skipped + summary.errors;
console.log("");
console.log(`Dry run:         ${args.dryRun ? "yes" : "no"}`);
console.log(`Processed:       ${processed.toLocaleString()}`);
console.log(`Uploaded:        ${summary.uploaded.toLocaleString()}`);
console.log(`Skipped:         ${summary.skipped.toLocaleString()}`);
console.log(`Errors:          ${summary.errors.toLocaleString()}`);
for (const [reason, count] of Object.entries(summary.reasons)) {
  console.log(`Skip ${reason}: ${count.toLocaleString()}`);
}
if (summary.rateLimited) {
  console.log(`Rate limited:    yes`);
  if (summary.rateLimitedResetAt) {
    console.log(`Rate reset at:   ${summary.rateLimitedResetAt}`);
  }
  if (summary.rateLimitedRetryAfter !== null) {
    console.log(`Retry after:     ${summary.rateLimitedRetryAfter}`);
  }
}
if (nextCursor) {
  console.log(`Next cursor:     ${nextCursor}`);
}
