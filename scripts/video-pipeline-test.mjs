#!/usr/bin/env node
// Exercises the explainer-video pipeline on a deployed site the way a
// browser does, and reports what happened. Meant for the staging copy
// (scripts/cf-staging.mjs), whose bucket, Redis and Stripe key are its own;
// the read-only commands (stream, health, logs, metrics) are safe on the live
// site too.
//
//   node scripts/video-pipeline-test.mjs renders 5            5 MP4 renders at once
//   node scripts/video-pipeline-test.mjs renders 3 --abort 6  ...and leave after 6 s
//   node scripts/video-pipeline-test.mjs renders 3 --raw      ...one request each, no asking again when a stream is cut
//   node scripts/video-pipeline-test.mjs stream owner/repo landscape   one render, every event timed
//   node scripts/video-pipeline-test.mjs generate owner/repo [--abort s]   a real video (paid model calls)
//   node scripts/video-pipeline-test.mjs generations 5 owner/repo   staging: 5 generations of one repository at once
//                                                 (free with scripts/video-model-replay.mjs answering the model calls)
//   node scripts/video-pipeline-test.mjs cancel owner/repo     staging: do abandoned segment renders free their Chromiums?
//   node scripts/video-pipeline-test.mjs reset                delete staging's MP4s so they render again
//   node scripts/video-pipeline-test.mjs state                staging: each container's state
//   node scripts/video-pipeline-test.mjs stop|kill render 0   staging: SIGTERM / SIGKILL an instance
//   node scripts/video-pipeline-test.mjs stop|kill generate
//   node scripts/video-pipeline-test.mjs cron "*/15 * * * *"  staging: run a cron handler now
//   node scripts/video-pipeline-test.mjs metrics [minutes] [app]   container memory and CPU (Cloudflare analytics)
//   node scripts/video-pipeline-test.mjs logs <text> [hours]  stored log lines containing the text
//   node scripts/video-pipeline-test.mjs health [days] [--staging]   runs started, made, failed and lost, and the error lines
//
// Settings (environment):
//   VIDEO_TEST_ORIGIN   default https://gitdiagram-staging.gitdiagram-presence.workers.dev
//   VIDEO_ADMIN_TOKEN   default ~/.config/gitdiagram/video-admin-token (the operator: no limits are consumed)
//   VIDEO_TEST_VIDEOS   default ~/.config/gitdiagram/staging/videos.txt (owner/repo per line)
//   CLOUDFLARE_API_TOKEN  default ~/.config/gitdiagram/cloudflare-api-token (metrics, logs)
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ACCOUNT = "8a4f309f2639721dc9f4f0d1790fd6d5";
const STAGING = "https://gitdiagram-staging.gitdiagram-presence.workers.dev";
const origin = (process.env.VIDEO_TEST_ORIGIN ?? STAGING).replace(/\/$/, "");
const config = (name) => join(homedir(), ".config/gitdiagram", name);
const fromFile = (path) =>
  existsSync(path) ? readFileSync(path, "utf8").trim() : "";
const adminToken =
  process.env.VIDEO_ADMIN_TOKEN ?? fromFile(config("video-admin-token"));
const cloudflareToken =
  process.env.CLOUDFLARE_API_TOKEN ?? fromFile(config("cloudflare-api-token"));

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : (args[at + 1] ?? "");
};
const positional = args.filter(
  (arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"),
);
const [command, ...rest] = positional;

const seconds = (ms) => (ms / 1000).toFixed(1);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function videos() {
  const file = process.env.VIDEO_TEST_VIDEOS ?? config("staging/videos.txt");
  return fromFile(file).split("\n").filter(Boolean);
}

const operatorHeaders = () => ({
  "Content-Type": "application/json",
  Origin: origin,
  Authorization: `Bearer ${adminToken}`,
});

async function videoState(repository) {
  const [username, repo] = repository.split("/");
  const response = await fetch(
    `${origin}/api/video?${new URLSearchParams({ username, repo })}`,
  );
  return response.json();
}

/**
 * POST to a streaming video route and time every server-sent event. Resolves
 * with how it ended: "complete", "error", "ended" (the stream closed with no
 * final event), "aborted" (this script left), "dropped" (the connection
 * broke) or the HTTP status of a refusal.
 */
async function stream(path, body, { abortAfterMs, onEvent } = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = abortAfterMs
    ? setTimeout(() => controller.abort(), abortAfterMs)
    : null;
  const result = {
    outcome: "ended",
    status: 0,
    firstByteMs: null,
    events: 0,
    // The longest silence between two chunks: a buffered stream shows up as
    // one long gap and then everything at once.
    longestGapMs: 0,
    ms: 0,
    instance: null,
    error: null,
  };
  try {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: operatorHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    result.status = response.status;
    result.instance = response.headers.get("x-render-instance");
    if (flag("verbose") !== undefined)
      console.error(
        `answered ${response.status} by instance ${result.instance ?? "-"}`,
      );
    if (!response.ok || !response.body) {
      result.outcome = String(response.status);
      result.error = (await response.text()).slice(0, 200);
      return result;
    }
    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();
    let buffer = "";
    let last = Date.now();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const now = Date.now();
      result.firstByteMs ??= now - started;
      result.longestGapMs = Math.max(result.longestGapMs, now - last);
      last = now;
      buffer += value;
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end === -1) break;
        const chunk = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (!chunk.startsWith("data: ")) continue;
        const event = JSON.parse(chunk.slice(6));
        result.events++;
        onEvent?.(event, now - started);
        if (event.status === "complete" || event.status === "error") {
          result.outcome = event.status;
          result.error = event.error ?? null;
        }
      }
    }
  } catch (error) {
    result.outcome = controller.signal.aborted ? "aborted" : "dropped";
    result.error = controller.signal.aborted
      ? null
      : String(error).slice(0, 200);
  } finally {
    if (timer) clearTimeout(timer);
    result.ms = Date.now() - started;
  }
  return result;
}

/**
 * One MP4 render as the page asks for it (streamExplainerRender in
 * src/features/explainer/api.ts): when the stream is cut or the server says
 * the MP4 is being made, ask again every four seconds until it is there.
 * `asked` counts the requests it took. With --raw, one request only.
 */
async function renderLikeThePage(body, options) {
  const started = Date.now();
  let asked = 0;
  let unavailable = 0;
  for (;;) {
    const result = await stream("/api/video/render", body, options);
    asked++;
    const again =
      flag("raw") === undefined &&
      !options.abortAfterMs &&
      Date.now() - started < 14 * 60_000 &&
      (result.outcome === "ended" ||
        result.outcome === "dropped" ||
        result.outcome === "409" ||
        (result.outcome === "503" && ++unavailable <= 3));
    if (!again) return { ...result, asked, ms: Date.now() - started };
    await sleep(4_000);
  }
}

/** `count` renders nobody has made yet, as [repository, format, version]. */
async function unrendered(count) {
  const jobs = [];
  for (const repository of videos()) {
    const state = await videoState(repository);
    const video = state.video;
    if (!video) continue;
    for (const format of ["landscape", "vertical"]) {
      const [username, repo] = repository.split("/");
      const file = await fetch(
        `${origin}/api/video/file?${new URLSearchParams({ username, repo, format, v: video.createdAt })}`,
        { redirect: "manual" },
      );
      await file.body?.cancel();
      if (file.status === 404) jobs.push([repository, format, video.createdAt]);
      if (jobs.length === count) return jobs;
    }
  }
  return jobs;
}

async function renders() {
  const count = Number(rest[0] ?? 3);
  const abort = flag("abort");
  const jobs = await unrendered(count);
  if (jobs.length < count)
    console.log(
      `only ${jobs.length} unrendered MP4s left; run "reset" for more`,
    );
  const started = Date.now();
  const results = await Promise.all(
    jobs.map(async ([repository, format, v]) => {
      const [username, repo] = repository.split("/");
      const result = await renderLikeThePage(
        { username, repo, format, v },
        { abortAfterMs: abort ? Number(abort) * 1000 : undefined },
      );
      return { repository, format, ...result };
    }),
  );
  for (const r of results)
    console.log(
      `${r.outcome.padEnd(8)} ${seconds(r.ms).padStart(6)}s  first byte ${r.firstByteMs ?? "-"} ms  events ${String(r.events).padStart(3)}  longest gap ${seconds(r.longestGapMs)}s  asked ${r.asked}x  ${r.repository} ${r.format}${r.error ? `  (${r.error})` : ""}`,
    );
  const done = results.filter((r) => r.outcome === "complete");
  const times = done.map((r) => r.ms).sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      renders: results.length,
      complete: done.length,
      wallSeconds: Number(seconds(Date.now() - started)),
      fastestSeconds: times.length ? Number(seconds(times[0])) : null,
      medianSeconds: times.length
        ? Number(seconds(times[times.length >> 1]))
        : null,
      slowestSeconds: times.length ? Number(seconds(times.at(-1))) : null,
    }),
  );
  if (!abort && done.length !== results.length) process.exitCode = 1;
}

async function streamOne(path, body) {
  const abort = flag("abort");
  const result = await stream(path, body, {
    abortAfterMs: abort ? Number(abort) * 1000 : undefined,
    onEvent: (event, at) =>
      console.log(
        `${seconds(at).padStart(6)}s ${event.status}${event.progress !== undefined && typeof event.progress === "number" ? ` ${Math.round(event.progress * 100)}%` : ""}${event.step ? ` ${event.step}` : ""}${event.error ? ` ${event.error}` : ""}`,
      ),
  });
  console.log(JSON.stringify(result));
  if (!abort && result.outcome !== "complete") process.exitCode = 1;
}

async function hook(path, method = "POST") {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log(response.status, await response.text());
}

async function cloudflare(path, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cloudflareToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return response.json();
}

/** One command to staging's Redis (its REST front), from the staging settings. */
async function stagingRedis(command) {
  const settings = JSON.parse(fromFile(config("staging/env.json")));
  const response = await fetch(settings.UPSTASH_REDIS_REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  return (await response.json()).result;
}

/**
 * Several generations of one repository at once, to load the generation
 * container. A repository's lock allows one run at a time, so this keeps
 * deleting it from staging's Redis while the runs start. With the model
 * stand-in replaying, every run gets the recorded answers and costs nothing;
 * the repository must be the recorded one.
 */
async function generations() {
  const count = Number(rest[0] ?? 3);
  const [owner, name] = (rest[1] ?? "").split("/");
  const lock = `video:v1:lock:generate:${owner}/${name}`.toLowerCase();
  let unlocking = true;
  const unlocker = (async () => {
    while (unlocking) {
      await stagingRedis(["DEL", lock]).catch(() => undefined);
      await sleep(40);
    }
  })();
  const started = Date.now();
  const runs = Array.from({ length: count }, async (_, index) => {
    // A little apart, so each finds the lock free.
    await sleep(index * 700);
    return stream("/api/video/generate", { username: owner, repo: name });
  });
  // Every run holds the lock from its first second; none starts after this.
  setTimeout(() => (unlocking = false), count * 700 + 5_000);
  const results = await Promise.all(runs);
  unlocking = false;
  await unlocker;
  for (const r of results)
    console.log(
      `${r.outcome.padEnd(8)} ${seconds(r.ms).padStart(6)}s  first byte ${r.firstByteMs ?? "-"} ms  events ${String(r.events).padStart(3)}  longest gap ${seconds(r.longestGapMs)}s${r.error ? `  (${r.error})` : ""}`,
    );
  const done = results.filter((r) => r.outcome === "complete");
  console.log(
    JSON.stringify({
      generations: count,
      complete: done.length,
      wallSeconds: Number(seconds(Date.now() - started)),
      slowestSeconds: Number(seconds(Math.max(...results.map((r) => r.ms)))),
    }),
  );
  if (done.length !== count) process.exitCode = 1;
}

/**
 * Post one signed segment job, as a render does (segments.ts signs the same
 * way). Resolves with the HTTP status once the answer starts; the body is
 * left unread, to be dropped by aborting `signal`.
 */
async function postSegment(video, from, signal) {
  const settings = JSON.parse(fromFile(config("staging/env.json")));
  const key = createHmac("sha256", settings.CACHE_KEY_SECRET.trim())
    .update("video-segment-key/v1")
    .digest();
  const job = {
    username: video.meta.owner,
    repo: video.meta.repo,
    v: video.createdAt,
    format: "landscape",
    from,
    to: from + 150,
    exp: Date.now() + 600_000,
  };
  const signature = createHmac("sha256", key)
    .update(
      JSON.stringify([
        job.username.toLowerCase(),
        job.repo.toLowerCase(),
        job.v,
        job.format,
        job.from,
        job.to,
        job.exp,
      ]),
    )
    .digest("hex");
  const response = await fetch(`${origin}/api/video/render/segment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Video-Segment": signature,
    },
    body: JSON.stringify(job),
    signal,
  });
  return response.status;
}

/**
 * Fill the pool's ten Chromium slots with segment renders, walk away from all
 * of them after five seconds (what a render that fails or is called off
 * does), and see whether ten new jobs are taken at once: a slot whose render
 * was not cancelled answers busy.
 */
async function cancel() {
  const { video } = await videoState(rest[0]);
  if (!video) throw new Error("That repository has no video.");
  const frames = Array.from({ length: 10 }, (_, index) => index * 150);
  const round = async (holdMs) => {
    const controller = new AbortController();
    const statuses = await Promise.all(
      frames.map((from) =>
        postSegment(video, from, controller.signal).catch(() => 0),
      ),
    );
    await sleep(holdMs);
    controller.abort();
    return statuses;
  };
  const first = await round(5_000);
  console.log(`first ten jobs: ${first.join(" ")}`);
  await sleep(2_000);
  const second = await round(500);
  console.log(`ten more, 2 s after leaving the first: ${second.join(" ")}`);
  const taken = second.filter((status) => status === 200).length;
  console.log(`${taken} of 10 slots were free again`);
  if (taken !== 10) process.exitCode = 1;
}

/** Stored log lines (Workers and containers) whose text contains `needle`. */
async function logs(needle, hours = 1, limit = 100) {
  // Cloudflare's log query now and then answers "completed" with nothing
  // for a search that has matches, so an empty answer is asked for again.
  for (let attempt = 0; ; attempt++) {
    const now = Date.now();
    const answer = await cloudflare(
      `/accounts/${ACCOUNT}/workers/observability/telemetry/query`,
      {
        queryId: `q${now}`,
        timeframe: { from: now - hours * 3_600_000, to: now },
        view: "events",
        limit,
        parameters: {
          needle: { value: needle, matchCase: false, isRegex: false },
          filters: [],
        },
      },
    );
    const events = answer.result?.events?.events ?? [];
    if (!events.length && attempt < 2) {
      await sleep(1_500);
      continue;
    }
    return events.map((event) => ({
      at: new Date(event.timestamp).toISOString(),
      worker: event.$workers?.scriptName ?? event.$metadata?.service,
      ...(typeof event.source === "object"
        ? event.source
        : { message: event.source }),
    }));
  }
}

/** Peak memory and CPU per container instance, minute by minute. */
async function metrics() {
  const minutes = Number(rest[0] ?? 15);
  const app = rest[1] ?? "";
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const answer = await cloudflare("/graphql", {
    query: `query($account: String!, $since: Time!) {
      viewer { accounts(filter: { accountTag: $account }) {
        containersMetricsAdaptiveGroups(limit: 2000, filter: { datetime_geq: $since }, orderBy: [datetimeMinute_ASC]) {
          dimensions { datetimeMinute applicationId durableObjectId }
          max { memory cpuLoad diskUsage }
          sum { cpuTimeSec }
        }
      } }
    }`,
    variables: { account: ACCOUNT, since },
  });
  if (answer.errors) return console.log(JSON.stringify(answer.errors));
  const rows =
    answer.data.viewer.accounts[0].containersMetricsAdaptiveGroups ?? [];
  const peaks = new Map();
  for (const row of rows) {
    const { applicationId, durableObjectId, datetimeMinute } = row.dimensions;
    if (app && !applicationId.startsWith(app)) continue;
    const key = `${applicationId.slice(0, 8)} ${durableObjectId.slice(0, 8)}`;
    const peak = peaks.get(key) ?? {
      memoryMiB: 0,
      cpuLoad: 0,
      cpuSeconds: 0,
      diskMB: 0,
      minutes: 0,
    };
    peak.memoryMiB = Math.max(
      peak.memoryMiB,
      Math.round(row.max.memory / 2 ** 20),
    );
    peak.cpuLoad = Math.max(peak.cpuLoad, Number(row.max.cpuLoad.toFixed(2)));
    peak.diskMB = Math.max(peak.diskMB, Math.round(row.max.diskUsage / 1e6));
    peak.cpuSeconds += row.sum.cpuTimeSec;
    peak.minutes++;
    peaks.set(key, peak);
    if (flag("rows") !== undefined)
      console.log(
        `${datetimeMinute} ${key} mem ${Math.round(row.max.memory / 2 ** 20)} MiB cpuLoad ${row.max.cpuLoad.toFixed(2)} cpu ${row.sum.cpuTimeSec.toFixed(1)}s`,
      );
  }
  for (const [key, peak] of peaks)
    console.log(
      `${key}  peak memory ${peak.memoryMiB} MiB  peak cpu load ${peak.cpuLoad}  cpu ${peak.cpuSeconds.toFixed(0)} s  disk ${peak.diskMB} MB  (${peak.minutes} min)`,
    );
}

/** Delete every stored MP4 in the staging bucket, so renders run again. */
async function reset() {
  const settings = JSON.parse(fromFile(config("staging/env.json")));
  const bucket = settings.R2_PUBLIC_BUCKET;
  if (!/staging|test/.test(bucket)) throw new Error("Not a staging bucket.");
  const { S3Client, ListObjectsV2Command, DeleteObjectCommand } =
    await import("@aws-sdk/client-s3");
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: settings.R2_ACCESS_KEY_ID,
      secretAccessKey: settings.R2_SECRET_ACCESS_KEY,
    },
  });
  let deleted = 0;
  let token;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "video/v1/",
        ContinuationToken: token,
      }),
    );
    for (const object of page.Contents ?? [])
      if (object.Key.endsWith(".mp4")) {
        await s3.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }),
        );
        deleted++;
      }
    token = page.NextContinuationToken;
  } while (token);
  console.log(`deleted ${deleted} MP4s from ${bucket}`);
}

/**
 * The pipeline's score: what the run journal counted (run-journal.ts) for
 * each of the last `days` UTC days, and the last day's error lines from the
 * containers and the Worker. Exits 1 if anything failed or was lost.
 */
async function health() {
  const days = Number(rest[0] ?? 2);
  const staging = flag("staging") !== undefined;
  const settings = JSON.parse(
    fromFile(
      process.env.CF_ENV_FILE ??
        config(staging ? "staging/env.json" : "cloudflare/production.env.json"),
    ),
  );
  const redis = async (command) => {
    const response = await fetch(settings.UPSTASH_REDIS_REST_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.UPSTASH_REDIS_REST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });
    return (await response.json()).result;
  };
  let bad = 0;
  for (let back = 0; back < days; back++) {
    const day = new Date(Date.now() - back * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const stored = (await redis(["HGETALL", `video:v1:health:${day}`])) ?? [];
    const counts = {};
    for (let index = 0; index + 1 < stored.length; index += 2)
      counts[stored[index]] = Number(stored[index + 1]);
    for (const where of ["cloudflare", "vercel"])
      for (const kind of ["generate", "render"]) {
        const get = (what) => counts[`${where}:${kind}:${what}`] ?? 0;
        if (!get("started")) continue;
        if (where === "cloudflare") bad += get("error") + get("lost");
        console.log(
          `${day} ${where.padEnd(10)} ${kind === "generate" ? "videos" : "MP4s  "}  started ${get("started")}  made ${get("complete")}  failed ${get("error")}  lost ${get("lost")}  unsettled ${get("started") - get("complete") - get("error") - get("lost")}`,
        );
      }
  }
  const running = await redis(["ZCARD", "video:v1:runs"]);
  console.log(`running now: ${running ?? 0}`);
  const failures = (await redis(["LRANGE", "video:v1:failures", 0, 19])) ?? [];
  console.log(`latest failed or lost runs (${failures.length}):`);
  for (const line of failures) console.log(`  ${line}`);
  // Stored log lines: a second opinion, and where segment retries and
  // container stops show. Best effort (see logs()).
  if (!staging && cloudflareToken)
    for (const needle of [
      "video.render.failed",
      "video.generation_failed",
      "video.segment.failed",
      "video.run.lost",
      "video.poster.remote_failed",
      "container.error",
      "container.unreachable",
    ]) {
      const lines = (await logs(needle, 24, 50)).filter(
        (line) => !/staging|render-test/.test(String(line.worker)),
      );
      console.log(`${needle}: ${lines.length} in 24 h`);
      for (const line of lines.slice(0, 5))
        console.log(`  ${JSON.stringify(line).slice(0, 300)}`);
    }
  if (bad) process.exitCode = 1;
}

const [username, repo] = (rest[0] ?? "").split("/");
switch (command) {
  case "renders":
    await renders();
    break;
  case "stream": {
    const state = await videoState(rest[0]);
    if (!state.video) throw new Error("That repository has no video.");
    await streamOne("/api/video/render", {
      username,
      repo,
      format: rest[1] ?? "landscape",
      v: state.video.createdAt,
    });
    break;
  }
  case "generate":
    await streamOne("/api/video/generate", { username, repo });
    break;
  case "generations":
    await generations();
    break;
  case "cancel":
    await cancel();
    break;
  case "reset":
    await reset();
    break;
  case "state":
    await hook("/__containers/state", "GET");
    break;
  case "stop":
  case "kill":
    await hook(`/__containers/${command}?c=${rest[0]}&i=${rest[1] ?? 0}`);
    break;
  case "cron":
    await hook(`/__cron?cron=${encodeURIComponent(rest[0])}`);
    break;
  case "metrics":
    await metrics();
    break;
  case "health":
    await health();
    break;
  case "logs":
    for (const line of await logs(rest[0], Number(rest[1] ?? 1)))
      console.log(JSON.stringify(line));
    break;
  default:
    console.log(
      readFileSync(new URL(import.meta.url), "utf8")
        .split("\n")
        .slice(1, 32)
        .join("\n"),
    );
    await sleep(0);
    process.exitCode = 1;
}
