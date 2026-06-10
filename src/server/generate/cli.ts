import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

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

function getCliCommand(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.AI_CLI_COMMAND?.trim();
  if (!configured) {
    throw new Error(
      "Missing AI_CLI_COMMAND. Set it to a non-interactive command such as `codex exec --sandbox read-only -` or `copilot`.",
    );
  }

  const parts = splitCommand(configured);
  if (!parts.length) {
    throw new Error("AI_CLI_COMMAND is empty.");
  }
  return parts;
}

export function getCliTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.AI_CLI_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 900_000;
}

function normalizeExecutableName(command: string): string {
  return basename(command).replace(/\.exe$/i, "").toLowerCase();
}

function isCopilotCommand(command: string): boolean {
  return normalizeExecutableName(command) === "copilot";
}

function hasCopilotManagedPromptArg(args: string[]): boolean {
  return args.some(
    (arg) =>
      arg === "-p" ||
      arg === "--prompt" ||
      arg.startsWith("--prompt=") ||
      arg === "--attachment" ||
      arg.startsWith("--attachment="),
  );
}

function toSignedRtfCodeUnit(value: number): number {
  return value > 0x7fff ? value - 0x10000 : value;
}

function toRtfDocument(text: string): string {
  let result = "{\\rtf1\\ansi\\deff0\n";

  for (const char of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")) {
    if (char === "\n") {
      result += "\\par\n";
      continue;
    }

    if (char === "\t") {
      result += "\\tab ";
      continue;
    }

    if (char === "\\" || char === "{" || char === "}") {
      result += `\\${char}`;
      continue;
    }

    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }

    if (codePoint >= 0x20 && codePoint <= 0x7e) {
      result += char;
      continue;
    }

    if (codePoint <= 0xffff) {
      result += `\\u${toSignedRtfCodeUnit(codePoint)}?`;
      continue;
    }

    const adjusted = codePoint - 0x10000;
    const highSurrogate = 0xd800 + (adjusted >> 10);
    const lowSurrogate = 0xdc00 + (adjusted & 0x3ff);
    result += `\\u${toSignedRtfCodeUnit(highSurrogate)}?`;
    result += `\\u${toSignedRtfCodeUnit(lowSurrogate)}?`;
  }

  return `${result}\n}`;
}

export function buildCliPrompt(params: {
  systemPrompt: string;
  userPrompt: string;
  reasoningEffort?: ReasoningEffort;
}): string {
  return [
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
}

export interface CliInvocation {
  command: string;
  args: string[];
  cwd: string;
  shell: boolean;
  stdin: string | null;
  cleanup: () => Promise<void>;
}

async function createCopilotInvocation(params: {
  command: string;
  baseArgs: string[];
  prompt: string;
}): Promise<CliInvocation> {
  if (hasCopilotManagedPromptArg(params.baseArgs)) {
    throw new Error(
      "When AI_CLI_COMMAND uses `copilot`, omit `-p/--prompt` and `--attachment`. GitDiagram provides the prompt file automatically.",
    );
  }

  const tempDir = await mkdtemp(join(tmpdir(), "gitdiagram-copilot-"));
  const promptPath = join(tempDir, "prompt.rtf");
  await writeFile(promptPath, toRtfDocument(params.prompt), "utf8");

  return {
    command: params.command,
    args: [
      ...params.baseArgs,
      "-p",
      "Use the attached RTF file as the full instruction set. Follow it exactly, do not use tools, and print only the final answer requested by the file.",
      "--attachment",
      "prompt.rtf",
      "--allow-all-tools",
      "--no-ask-user",
      "--no-custom-instructions",
      "--output-format",
      "text",
      "--stream",
      "off",
      "-s",
    ],
    cwd: tempDir,
    shell: false,
    stdin: null,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

export async function createCliInvocation(
  params: {
    systemPrompt: string;
    userPrompt: string;
    reasoningEffort?: ReasoningEffort;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<CliInvocation> {
  const [command, ...baseArgs] = getCliCommand(env);
  const prompt = buildCliPrompt(params);

  if (isCopilotCommand(command!)) {
    return await createCopilotInvocation({
      command: command!,
      baseArgs,
      prompt,
    });
  }

  return {
    command: command!,
    args: baseArgs,
    cwd: process.cwd(),
    shell: process.platform === "win32",
    stdin: prompt,
    cleanup: async () => {},
  };
}

export async function runCliCompletion(params: {
  systemPrompt: string;
  userPrompt: string;
  reasoningEffort?: ReasoningEffort;
  signal?: AbortSignal;
}): Promise<{ text: string; usage: GenerationTokenUsage | null }> {
  const invocation = await createCliInvocation(params);

  return await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: process.env,
      shell: invocation.shell,
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
      void invocation.cleanup().then(
        () => {
          if (error) {
            reject(error);
          } else {
            resolve({ text: stdout.trim(), usage: null });
          }
        },
        (cleanupError: unknown) => {
          reject(
            error ??
              (cleanupError instanceof Error
                ? cleanupError
                : new Error(String(cleanupError))),
          );
        },
      );
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

    child.stdin?.end(invocation.stdin ?? undefined);
  });
}
