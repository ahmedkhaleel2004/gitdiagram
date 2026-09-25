import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runProcess } from "./child-process";

const node = process.execPath;

describe("runProcess", () => {
  it("pipes input through and resolves with stdout", async () => {
    const out = await runProcess(
      node,
      ["-e", "process.stdin.pipe(process.stdout)"],
      { input: Buffer.from("hello"), stdout: true },
    );
    expect(out.toString()).toBe("hello");
  });

  it("rejects with stderr when the process fails", async () => {
    await expect(
      runProcess(node, ["-e", "console.error('boom'); process.exit(3)"], {
        label: "tool",
      }),
    ).rejects.toThrow("tool failed (3): boom");
  });

  it("rejects instead of crashing when the process exits before reading its input", async () => {
    await expect(
      runProcess(node, ["-e", "process.exit(1)"], {
        input: Buffer.alloc(8 * 1024 * 1024),
      }),
    ).rejects.toThrow("failed (1)");
  });

  it("kills the process when aborted", async () => {
    const controller = new AbortController();
    const running = runProcess(node, ["-e", "setInterval(() => {}, 1000)"], {
      signal: controller.signal,
    });
    controller.abort(new Error("stopped"));
    await expect(running).rejects.toThrow("stopped");
  });

  it("kills the process after its timeout", async () => {
    await expect(
      runProcess(node, ["-e", "setInterval(() => {}, 1000)"], {
        timeoutMs: 50,
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("rejects at once when already aborted", async () => {
    await expect(
      runProcess(node, ["-e", ""], { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
