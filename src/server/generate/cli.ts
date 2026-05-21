import { spawn } from "node:child_process";

import type { GenerationTokenUsage } from "~/features/diagram/cost";
import type { ReasoningEffort } from "~/server/generate/openai";

function splitCommand(value: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (!char) continue;
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (/\s/.test(char) && !quote) {
      if (current) {
        result.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) result.push(current);
  return result;
}

function getCliCommand(): string[] {
  const configured = process.env.AI_CLI_COMMAND?.trim();
  if (!configured) {
    throw new Error(
      "Missing AI_CLI_COMMAND. Set it to a non-interactive command that reads the prompt from stdin, such as `codex exec --sandbox read-only -`.",
    );
  }

  const parts = splitCommand(configured);
  if (!parts.length) {
    throw new Error("AI_CLI_COMMAND is empty.");
  }
  return parts;
}

function getCliTimeoutMs(): number {
  const parsed = Number(process.env.AI_CLI_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
}

export async function runCliCompletion(params: {
  systemPrompt: string;
  userPrompt: string;
  reasoningEffort?: ReasoningEffort;
  signal?: AbortSignal;
}): Promise<{ text: string; usage: GenerationTokenUsage | null }> {
  const [command, ...baseArgs] = getCliCommand();
  const prompt = [
    params.systemPrompt,
    "",
    params.userPrompt,
    "",
    params.reasoningEffort
      ? `Reasoning effort requested by GitDiagram: ${params.reasoningEffort}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return await new Promise((resolve, reject) => {
    const child = spawn(command!, baseArgs, {
      cwd: process.cwd(),
      env: process.env,
      shell: process.platform === "win32",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      params.signal?.removeEventListener("abort", abort);
      if (error) {
        reject(error);
      } else {
        resolve({ text: stdout.trim(), usage: null });
      }
    };

    const abort = () => {
      child.kill();
      finish(new DOMException("Generation aborted.", "AbortError"));
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish(
        new Error(`AI_CLI_COMMAND timed out after ${getCliTimeoutMs()}ms.`),
      );
    }, getCliTimeoutMs());

    params.signal?.addEventListener("abort", abort, { once: true });
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code === 0) {
        finish();
        return;
      }

      finish(
        new Error(
          `AI_CLI_COMMAND failed with exit code ${code ?? "unknown"}.${
            stderr.trim() ? `\n${stderr.trim()}` : ""
          }`,
        ),
      );
    });

    child.stdin?.end(prompt);
  });
}
