import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  readClaudeCredit: vi.fn(),
  voiceCreditUsd: vi.fn(),
  readControlsForDisplay: vi.fn(),
}));

vi.mock("~/server/admin/claude-credit", () => ({
  readClaudeCredit: mocks.readClaudeCredit,
}));
vi.mock("~/server/admin/controls", () => ({
  readControlsForDisplay: mocks.readControlsForDisplay,
}));
vi.mock("~/server/admin/live-events", () => ({
  createPresenceToken: () => null,
  presenceSocketUrl: () => null,
}));
vi.mock("~/server/explainer/limits", () => ({
  videoUsageToday: async () => null,
}));
vi.mock("~/server/explainer/narration", () => ({
  narrationPausedUntil: async () => null,
}));
vi.mock("~/server/explainer/voice", () => ({
  voiceCreditUsd: mocks.voiceCreditUsd,
}));
vi.mock("~/server/generate/complimentary-gate", () => ({
  readComplimentaryUsageToday: async () => null,
}));

const CONTROLS = { videoAudience: "priority", videosPaused: false };
const never = () => new Promise<never>(() => undefined);

/** A fresh instance: no balance cached from another test. */
const load = async () => {
  vi.resetModules();
  return (await import("./state")).readAdminState;
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.readControlsForDisplay.mockResolvedValue({
    controls: CONTROLS,
    unreadable: false,
  });
  mocks.readClaudeCredit.mockResolvedValue({
    setUsd: 50,
    setAt: 1,
    spentUsd: 5,
  });
  mocks.voiceCreditUsd.mockResolvedValue(12.5);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

/** Reads the state, moving the clock on so deadlines can pass. */
async function read(readAdminState: Awaited<ReturnType<typeof load>>) {
  const state = readAdminState();
  await vi.advanceTimersByTimeAsync(3_000);
  return state;
}

describe("the dashboard's state", () => {
  it("shows a slow balance as unreadable instead of holding up the poll", async () => {
    const readAdminState = await load();
    mocks.readClaudeCredit.mockImplementation(never);
    mocks.voiceCreditUsd.mockImplementation(never);
    const state = await read(readAdminState);
    expect(state.claudeCredit).toBe("unreadable");
    expect(state.voiceCreditUsd).toBeNull();
    expect(state.controls).toBe(CONTROLS);
  });

  it("tells a missing admin key from a failed read", async () => {
    const readAdminState = await load();
    mocks.readClaudeCredit.mockResolvedValueOnce(null);
    expect((await read(readAdminState)).claudeCredit).toBe("no-key");
    mocks.readClaudeCredit.mockRejectedValueOnce(new Error("429"));
    expect((await read(readAdminState)).claudeCredit).toBe("unreadable");
    expect((await read(readAdminState)).claudeCredit).toEqual({
      setUsd: 50,
      setAt: 1,
      spentUsd: 5,
    });
  });

  it("asks OpenRouter for the voice balance at most every half minute", async () => {
    const readAdminState = await load();
    expect((await read(readAdminState)).voiceCreditUsd).toBe(12.5);
    mocks.voiceCreditUsd.mockResolvedValue(11);
    expect((await read(readAdminState)).voiceCreditUsd).toBe(12.5);
    expect(mocks.voiceCreditUsd).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await read(readAdminState)).voiceCreditUsd).toBe(11);
  });

  it("keeps a late voice balance for the next poll", async () => {
    const readAdminState = await load();
    let answer!: (usd: number) => void;
    mocks.voiceCreditUsd.mockImplementation(
      () => new Promise<number>((resolve) => (answer = resolve)),
    );
    expect((await read(readAdminState)).voiceCreditUsd).toBeNull();
    answer(9);
    expect((await read(readAdminState)).voiceCreditUsd).toBe(9);
    expect(mocks.voiceCreditUsd).toHaveBeenCalledTimes(1);
  });

  it("says when the switches could not be read", async () => {
    const readAdminState = await load();
    mocks.readControlsForDisplay.mockResolvedValue({
      controls: CONTROLS,
      unreadable: true,
    });
    expect((await read(readAdminState)).controlsUnreadable).toBe(true);
  });
});
