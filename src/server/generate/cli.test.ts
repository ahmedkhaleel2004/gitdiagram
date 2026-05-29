// @vitest-environment node
import { access, readFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildCliPrompt,
  createCliInvocation,
  getCliTimeoutMs,
} from "~/server/generate/cli";

describe("buildCliPrompt", () => {
  it("includes the requested reasoning effort when present", () => {
    expect(
      buildCliPrompt({
        systemPrompt: "system",
        userPrompt: "user",
        reasoningEffort: "high",
      }),
    ).toContain("Reasoning effort requested by GitDiagram: high.");
  });
});

describe("createCliInvocation", () => {
  const cleanupTasks: Array<() => Promise<void>> = [];
  const envWithCommand = (command: string): NodeJS.ProcessEnv => ({
    ...process.env,
    NODE_ENV: "test",
    AI_CLI_COMMAND: command,
  });

  afterEach(async () => {
    while (cleanupTasks.length > 0) {
      const cleanup = cleanupTasks.pop();
      if (!cleanup) continue;
      await cleanup();
    }
  });

  it("keeps stdin transport for generic CLI commands", async () => {
    const invocation = await createCliInvocation(
      {
        systemPrompt: "system",
        userPrompt: "user",
      },
      envWithCommand("codex exec --sandbox read-only -"),
    );

    cleanupTasks.push(invocation.cleanup);

    expect(invocation.command).toBe("codex");
    expect(invocation.args).toEqual(["exec", "--sandbox", "read-only", "-"]);
    expect(invocation.cwd).toBe(process.cwd());
    expect(invocation.stdin).toContain("system\nuser");
  });

  it("writes the prompt to an attachment file for copilot", async () => {
    const invocation = await createCliInvocation(
      {
        systemPrompt: "system",
        userPrompt: "user",
      },
      envWithCommand("copilot --model gpt-5.4"),
    );

    cleanupTasks.push(invocation.cleanup);

    expect(invocation.command).toBe("copilot");
    expect(invocation.stdin).toBeNull();
    expect(invocation.cwd).toMatch(/gitdiagram-copilot-/i);
    expect(invocation.args).toEqual(
      expect.arrayContaining([
        "--model",
        "gpt-5.4",
        "-p",
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
      ]),
    );

    const prompt = await readFile(`${invocation.cwd}\\prompt.rtf`, "utf8");
    expect(prompt).toContain("system");
    expect(prompt).toContain("user");
  });

  it("rejects copilot commands that already specify prompt transport", async () => {
    await expect(
      createCliInvocation(
        {
          systemPrompt: "system",
          userPrompt: "user",
        },
        envWithCommand("copilot -p existing"),
      ),
    ).rejects.toThrow(/omit `-p\/--prompt` and `--attachment`/);
  });

  it("cleans up the generated copilot temp directory", async () => {
    const invocation = await createCliInvocation(
      {
        systemPrompt: "system",
        userPrompt: "user",
      },
      envWithCommand("copilot"),
    );

    await access(`${invocation.cwd}\\prompt.rtf`);
    await invocation.cleanup();
    await expect(access(`${invocation.cwd}\\prompt.rtf`)).rejects.toThrow();
  });
});

describe("getCliTimeoutMs", () => {
  it("defaults to a 15 minute timeout for slow CLI providers", () => {
    expect(getCliTimeoutMs({ ...process.env, AI_CLI_TIMEOUT_MS: undefined })).toBe(
      900_000,
    );
  });

  it("uses the configured timeout when provided", () => {
    expect(getCliTimeoutMs({ ...process.env, AI_CLI_TIMEOUT_MS: "120000" })).toBe(
      120_000,
    );
  });
});
