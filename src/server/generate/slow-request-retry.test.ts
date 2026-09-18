import { afterEach, describe, expect, it, vi } from "vitest";
import { withSlowRequestRetry } from "./slow-request-retry";

afterEach(() => vi.useRealTimers());

function untilAborted(signal: AbortSignal): Promise<string> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

describe("slow managed request recovery", () => {
  it("leaves fast requests alone and clears the retry timer", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue("architecture");
    const onRetry = vi.fn();
    await expect(
      withSlowRequestRetry({
        signal: new AbortController().signal,
        retryAfterMs: 18_000,
        run,
        onRetry,
      }),
    ).resolves.toBe("architecture");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a stalled request before resetting and starting its only replacement", async () => {
    vi.useFakeTimers();
    const sequence: string[] = [];
    const run = vi.fn(async (signal: AbortSignal, attempt: number) => {
      sequence.push(`start ${attempt}`);
      if (attempt === 2) return "replacement";
      try {
        return await untilAborted(signal);
      } finally {
        sequence.push("cancelled 1");
      }
    });
    const promise = withSlowRequestRetry({
      signal: new AbortController().signal,
      retryAfterMs: 18_000,
      run,
      onRetry: async () => {
        sequence.push("reset");
      },
    });
    await vi.advanceTimersByTimeAsync(18_000);
    await expect(promise).resolves.toBe("replacement");
    expect(sequence).toEqual(["start 1", "cancelled 1", "reset", "start 2"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never retries user cancellation, even when it races the slow timer", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const run = vi.fn(untilAborted);
    const onRetry = vi.fn();
    const promise = withSlowRequestRetry({
      signal: controller.signal,
      retryAfterMs: 18_000,
      run,
      onRetry,
    });
    const check = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await vi.advanceTimersByTimeAsync(18_000);
    await check;
    expect(run).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("does not retry provider errors or the replacement request", async () => {
    vi.useFakeTimers();
    const signal = new AbortController().signal;
    const onRetry = vi.fn();
    const denied = vi.fn().mockRejectedValue(new Error("429"));
    await expect(
      withSlowRequestRetry({
        signal,
        retryAfterMs: 18_000,
        run: denied,
        onRetry,
      }),
    ).rejects.toThrow("429");
    expect(onRetry).not.toHaveBeenCalled();
    const run = vi
      .fn()
      .mockImplementationOnce(untilAborted)
      .mockRejectedValue(new Error("replacement failed"));
    const check = expect(
      withSlowRequestRetry({ signal, retryAfterMs: 18_000, run, onRetry }),
    ).rejects.toThrow("replacement failed");
    await vi.advanceTimersByTimeAsync(18_000);
    await check;
    expect(run).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("leaves caller-owned requests on their original signal without a timer", async () => {
    vi.useFakeTimers();
    const signal = new AbortController().signal;
    const run = vi.fn().mockResolvedValue("custom model");
    await withSlowRequestRetry({ signal, run, onRetry: vi.fn() });
    expect(run).toHaveBeenCalledWith(signal, 1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
