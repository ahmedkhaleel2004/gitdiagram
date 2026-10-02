#!/usr/bin/env node
// A stand-in for the model APIs a video generation calls (Anthropic, OpenAI,
// OpenRouter's voice), so the pipeline can be load-tested without paying for
// model calls. It records one real generation, then answers any number of
// later ones with what was recorded, at the recorded pace.
//
//   node scripts/video-model-replay.mjs record [dir]   forward to the real APIs and save each exchange
//   node scripts/video-model-replay.mjs replay [dir]   answer from the saved exchanges
//
// Point the server under test at it (PORT, default 8078; put it behind TLS if
// the server is not on this machine):
//   ANTHROPIC_BASE_URL=http://host:8078/anthropic
//   OPENAI_BASE_URL=http://host:8078/openai/v1
//   VIDEO_VOICE_API_BASE=http://host:8078/openrouter/api/v1
//
// Replay matches a request to a recording by its exact body, else by its
// shape (same path, model and tools), else by its path; so the generation
// replayed must be of the repository that was recorded. Request headers
// (which carry API keys) are forwarded when recording and never saved.
// REPLAY_SPEED (default 1) divides the recorded waits.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

const UPSTREAMS = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  openrouter: "https://openrouter.ai",
};
const [mode, dirArg] = process.argv.slice(2);
if (mode !== "record" && mode !== "replay") {
  console.error("usage: video-model-replay.mjs record|replay [dir]");
  process.exit(1);
}
const dir = dirArg ?? join(homedir(), ".cache/gitdiagram/video-replay");
mkdirSync(dir, { recursive: true });
const port = Number(process.env.PORT ?? 8078);
const speed = Number(process.env.REPLAY_SPEED ?? 1);

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** What kind of call this is, for matching when the body differs. */
function shapeOf(path, body) {
  try {
    const json = JSON.parse(body.toString("utf8"));
    const tools = (json.tools ?? [])
      .map((tool) => tool.name ?? tool.function?.name ?? tool.type)
      .join(",");
    const choice = JSON.stringify(json.tool_choice ?? "");
    return `${path}|${json.model ?? ""}|${tools}|${choice}|${json.stream ? "stream" : ""}`;
  } catch {
    return path;
  }
}

const recordings = existsSync(dir)
  ? readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")))
  : [];
let saved = recordings.length;
// Round-robin position per shape and per path, for inexact matches.
const turns = new Map();
const stats = { exact: 0, shape: 0, path: 0, missing: 0 };

function pick(upstream, path, body) {
  const hash = sha(body);
  const mine = recordings.filter(
    (recording) => recording.upstream === upstream && recording.path === path,
  );
  const exact = mine.find((recording) => recording.hash === hash);
  if (exact) {
    stats.exact++;
    return exact;
  }
  const shape = shapeOf(path, body);
  for (const [kind, pool] of [
    ["shape", mine.filter((recording) => recording.shape === shape)],
    ["path", mine],
  ]) {
    if (!pool.length) continue;
    const key = `${kind}:${upstream}:${kind === "shape" ? shape : path}`;
    const turn = turns.get(key) ?? 0;
    turns.set(key, turn + 1);
    stats[kind]++;
    return pool[turn % pool.length];
  }
  stats.missing++;
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function record(request, response, upstream, path, body) {
  const started = Date.now();
  const headers = { ...request.headers };
  delete headers.host;
  delete headers["content-length"];
  delete headers["accept-encoding"];
  const answer = await fetch(`${UPSTREAMS[upstream]}${path}`, {
    method: request.method,
    headers,
    body: body.length ? body : undefined,
  });
  const type = answer.headers.get("content-type") ?? "application/json";
  response.writeHead(answer.status, { "content-type": type });
  const chunks = [];
  if (answer.body)
    for await (const chunk of answer.body) {
      chunks.push({
        at: Date.now() - started,
        data: Buffer.from(chunk).toString("base64"),
      });
      response.write(chunk);
    }
  response.end();
  const name = `${String(saved++).padStart(3, "0")}-${upstream}.json`;
  writeFileSync(
    join(dir, name),
    JSON.stringify({
      upstream,
      method: request.method,
      path,
      hash: sha(body),
      shape: shapeOf(path, body),
      status: answer.status,
      type,
      chunks,
    }),
  );
  console.log(
    `recorded ${name} ${request.method} ${path} ${answer.status} ${Date.now() - started} ms`,
  );
}

async function replay(request, response, upstream, path, body) {
  const recording = pick(upstream, path, body);
  if (!recording) {
    response.writeHead(599, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "nothing recorded for this call" }));
    console.log(`MISSING ${request.method} ${upstream}${path}`);
    return;
  }
  const started = Date.now();
  let open = true;
  response.on("close", () => (open = false));
  response.writeHead(recording.status, { "content-type": recording.type });
  for (const chunk of recording.chunks) {
    const wait = chunk.at / speed - (Date.now() - started);
    if (wait > 0) await sleep(wait);
    if (!open) return;
    response.write(Buffer.from(chunk.data, "base64"));
  }
  response.end();
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://replay");
    if (url.pathname === "/stats") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ mode, recordings: saved, ...stats }));
      return;
    }
    const [, upstream, ...parts] = url.pathname.split("/");
    if (!UPSTREAMS[upstream]) {
      response.writeHead(404).end();
      return;
    }
    const path = `/${parts.join("/")}${url.search}`;
    const body = await readBody(request);
    await (mode === "record" ? record : replay)(
      request,
      response,
      upstream,
      path,
      body,
    );
  } catch (error) {
    console.log(`error ${String(error).slice(0, 200)}`);
    if (!response.headersSent) response.writeHead(502);
    response.end();
  }
}).listen(port, "127.0.0.1", () =>
  console.log(
    `${mode} on 127.0.0.1:${port}, ${recordings.length} recordings in ${dir}`,
  ),
);
