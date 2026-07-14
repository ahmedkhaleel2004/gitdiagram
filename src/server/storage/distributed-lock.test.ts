import { beforeEach, describe, expect, it, vi } from "vitest";

const upstashMocks = vi.hoisted(() => ({
  command: vi.fn(),
  eval: vi.fn(),
}));

vi.mock("~/server/storage/upstash", () => ({
  upstashCommand: upstashMocks.command,
  upstashEval: upstashMocks.eval,
}));

import { withDistributedLock } from "~/server/storage/distributed-lock";

describe("withDistributedLock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upstashMocks.command.mockResolvedValue("OK");
    upstashMocks.eval.mockResolvedValue(1);
  });

  it("acquires an expiring lock and releases only with its owner token", async () => {
    const callback = vi.fn().mockResolvedValue("saved");

    await expect(
      withDistributedLock({ key: "lock:test", callback }),
    ).resolves.toBe("saved");

    expect(callback).toHaveBeenCalledOnce();
    expect(upstashMocks.command).toHaveBeenCalledWith([
      "SET",
      "lock:test",
      expect.any(String),
      "NX",
      "PX",
      30_000,
    ]);
    expect(upstashMocks.eval).toHaveBeenCalledWith(
      expect.objectContaining({
        keys: ["lock:test"],
        args: [expect.any(String)],
      }),
    );
  });

  it("still releases the lock when the protected write fails", async () => {
    const failure = new Error("write failed");

    await expect(
      withDistributedLock({
        key: "lock:test",
        callback: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);

    expect(upstashMocks.eval).toHaveBeenCalledOnce();
  });
});
