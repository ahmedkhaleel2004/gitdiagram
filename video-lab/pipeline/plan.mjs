// Ask Claude Opus 5.5 for the video plan through the Claude Code CLI (`claude -p`),
// which runs on the local Claude login and reports usage and cost at API list prices.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA } from "./schema.mjs";
import { SYSTEM, userPrompt } from "./prompt.mjs";

export async function plan(ctx, opts = {}) {
  // One retry covers a transient CLI or network failure; a second failure is real.
  try {
    return await planOnce(ctx, opts);
  } catch (e) {
    console.error(`planner failed once (${String(e.message).slice(0, 200)}); retrying`);
    return await planOnce(ctx, opts);
  }
}

async function planOnce(ctx, { model = "claude-opus-5-5", effort = "low" } = {}) {
  const t0 = Date.now();
  const args = [
    "-p",
    "--model", model,
    "--effort", effort,
    "--system-prompt", SYSTEM,
    "--json-schema", JSON.stringify(SCHEMA),
    "--tools", "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--output-format", "json",
  ];
  // An empty scratch directory keeps project CLAUDE.md files out of the context.
  const cwd = mkdtempSync(join(tmpdir(), "gd-plan-"));
  const out = await new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`claude exited ${code}: ${stderr || stdout}`))));
    child.stdin.end(userPrompt(ctx));
  });
  const res = JSON.parse(out);
  if (res.is_error) throw new Error(`planner error: ${res.result}`);
  let spec = res.structured_output;
  if (!spec) {
    const text = String(res.result || "");
    spec = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  }
  if (!Array.isArray(spec?.beats) || spec.beats.length < 4) throw new Error("plan has too few beats");
  const mu = res.modelUsage?.[model] || {};
  return {
    spec,
    ms: Date.now() - t0,
    apiMs: res.duration_api_ms,
    costUsd: res.total_cost_usd,
    usage: {
      input: mu.inputTokens,
      cacheWrite: mu.cacheCreationInputTokens,
      cacheRead: mu.cacheReadInputTokens,
      output: mu.outputTokens,
      thinking: mu.thinkingTokens,
    },
  };
}
