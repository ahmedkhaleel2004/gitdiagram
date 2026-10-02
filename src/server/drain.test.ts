import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { beginWork, drainOnSignals, trackWork, workInFlight } from "./drain";

const listeners = () => [
  ...process.listeners("SIGTERM"),
  ...process.listeners("SIGINT"),
];

describe("draining on a stop signal", () => {
  const before = listeners();

  afterEach(() => {
    for (const signal of ["SIGTERM", "SIGINT"] as const)
      for (const listener of process.listeners(signal))
        if (!before.includes(listener)) process.off(signal, listener);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("counts work until it ends, once", async () => {
    const end = beginWork();
    expect(workInFlight()).toBe(1);
    end();
    end();
    expect(workInFlight()).toBe(0);
    await expect(
      trackWork(Promise.reject(new Error("failed"))),
    ).rejects.toThrow("failed");
    expect(workInFlight()).toBe(0);
  });

  it("exits at once when idle", () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const exit = vi.fn();
    drainOnSignals({ exit });
    process.emit("SIGTERM");
    expect(exit).toHaveBeenCalledExactlyOnceWith(143);
  });

  it("waits for work in flight, then exits", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const exit = vi.fn();
    drainOnSignals({ exit, pollMs: 100 });
    const end = beginWork();
    process.emit("SIGTERM");
    process.emit("SIGTERM");
    vi.advanceTimersByTime(5_000);
    expect(exit).not.toHaveBeenCalled();
    end();
    vi.advanceTimersByTime(100);
    expect(exit).toHaveBeenCalledExactlyOnceWith(143);
  });

  it("gives up waiting at the limit", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const exit = vi.fn();
    drainOnSignals({ exit, pollMs: 100, limitMs: 1_000 });
    const end = beginWork();
    process.emit("SIGINT");
    vi.advanceTimersByTime(900);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(exit).toHaveBeenCalledExactlyOnceWith(130);
    end();
  });
});
