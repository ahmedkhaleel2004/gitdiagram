import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upstashCommand: vi.fn(),
  upstashEval: vi.fn(),
}));

vi.mock("~/server/storage/upstash", () => ({
  upstashCommand: mocks.upstashCommand,
  upstashEval: mocks.upstashEval,
}));

import {
  GENERATION_ACTIVE_TTL_SECONDS,
  GENERATION_CANCELLATION_TTL_SECONDS,
  isGenerationCancelled,
  markGenerationCancelled,
  registerActiveGeneration,
  startGenerationCancellationPolling,
  unregisterActiveGeneration,
} from "~/server/generate/cancellation";

describe("generation cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("registers an unguessable active session without replacing a collision", async () => {
    mocks.upstashCommand
      .mockResolvedValueOnce("OK")
      .mockResolvedValueOnce(null);

    await expect(
      registerActiveGeneration(
        "550e8400-e29b-41d4-a716-446655440000",
        "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      ),
    ).resolves.toBe(true);
    await expect(
      registerActiveGeneration(
        "550e8400-e29b-41d4-a716-446655440000",
        "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      ),
    ).resolves.toBe(false);

    expect(mocks.upstashCommand).toHaveBeenNthCalledWith(1, [
      "SET",
      "generation:active:550e8400-e29b-41d4-a716-446655440000",
      "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "EX",
      GENERATION_ACTIVE_TTL_SECONDS,
      "NX",
    ]);
  });

  it("only marks and unregisters a session when its cancel token matches", async () => {
    mocks.upstashEval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(
      markGenerationCancelled(
        "550e8400-e29b-41d4-a716-446655440000",
        "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      ),
    ).resolves.toBe(true);
    await unregisterActiveGeneration(
      "550e8400-e29b-41d4-a716-446655440000",
      "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    );

    expect(mocks.upstashEval).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        keys: [
          "generation:active:550e8400-e29b-41d4-a716-446655440000",
          "generation:cancel:550e8400-e29b-41d4-a716-446655440000",
        ],
        args: [
          "f47ac10b-58cc-4372-a567-0e02b2c3d479",
          GENERATION_CANCELLATION_TTL_SECONDS,
        ],
      }),
    );
    expect(mocks.upstashEval).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        keys: [
          "generation:active:550e8400-e29b-41d4-a716-446655440000",
          "generation:cancel:550e8400-e29b-41d4-a716-446655440000",
        ],
        args: ["f47ac10b-58cc-4372-a567-0e02b2c3d479"],
      }),
    );
  });

  it("reads a cancellation marker", async () => {
    mocks.upstashCommand.mockResolvedValueOnce("1");

    await expect(
      isGenerationCancelled("550e8400-e29b-41d4-a716-446655440000"),
    ).resolves.toBe(true);

    expect(mocks.upstashCommand).toHaveBeenCalledWith([
      "GET",
      "generation:cancel:550e8400-e29b-41d4-a716-446655440000",
    ]);
  });

  it("polls without overlapping requests and stops after cancellation", async () => {
    vi.useFakeTimers();
    let resolveFirst!: (value: string | null) => void;
    mocks.upstashCommand
      .mockImplementationOnce(
        () =>
          new Promise<string | null>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce("1");
    const onCancelled = vi.fn();

    const stop = startGenerationCancellationPolling({
      sessionId: "550e8400-e29b-41d4-a716-446655440000",
      onCancelled,
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(mocks.upstashCommand).toHaveBeenCalledTimes(1);

    resolveFirst(null);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mocks.upstashCommand).toHaveBeenCalledTimes(2);
    expect(onCancelled).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.upstashCommand).toHaveBeenCalledTimes(2);
    stop();
  });

  it("backs off after the window where a user is most likely to cancel", async () => {
    vi.useFakeTimers();
    mocks.upstashCommand.mockResolvedValue(null);
    const stop = startGenerationCancellationPolling({
      sessionId: "550e8400-e29b-41d4-a716-446655440000",
      onCancelled: vi.fn(),
    });

    // First 15s stay at one poll per second: 1 immediate + 15 scheduled.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.upstashCommand).toHaveBeenCalledTimes(16);

    // The next 45s drop to one poll every 3s rather than another 45 requests.
    await vi.advanceTimersByTimeAsync(45_000);
    expect(mocks.upstashCommand).toHaveBeenCalledTimes(31);

    // A flat 1s poll would have issued 220 requests over a full-length
    // generation; the backoff keeps the whole run well under a quarter of that.
    await vi.advanceTimersByTimeAsync(160_000);
    expect(mocks.upstashCommand.mock.calls.length).toBeLessThan(70);
    stop();
  });

  it("keeps polling after a failure and logs only sanitized context", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.upstashCommand
      .mockRejectedValueOnce(new Error("Bearer secret-token"))
      .mockResolvedValueOnce("1");
    const onCancelled = vi.fn();

    startGenerationCancellationPolling({
      sessionId: "550e8400-e29b-41d4-a716-446655440000",
      onCancelled,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      "Cancellation status is temporarily unavailable",
    );
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("secret-token");
  });
});
