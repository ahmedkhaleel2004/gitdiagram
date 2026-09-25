import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminState, LiveControls } from "~/features/admin/types";
import { useAdminState } from "./use-admin-state";

const controls = (overrides: Partial<LiveControls> = {}): LiveControls => ({
  videoAudience: "priority",
  priorityPlaces: "cities",
  limitedCountryAccess: "some",
  limitedCountryShare: null,
  videosPaused: false,
  videoDailyLimit: null,
  videoPersonDailyLimit: null,
  videoPriorityPersonDailyLimit: null,
  videoNetworkDailyLimit: null,
  ...overrides,
});

const adminState = (overrides: Partial<LiveControls> = {}): AdminState => ({
  now: 0,
  controls: controls(overrides),
  controlsUnreadable: false,
  video: null,
  voicePausedUntil: null,
  voiceCreditUsd: null,
  claudeCredit: "no-key",
  diagramQuota: null,
  presence: null,
  deployment: { commit: null, region: null },
});

/** A response the test hands back whenever it likes (or the caller aborts). */
function deferred(signal?: AbortSignal | null) {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done, fail) => {
    resolve = done;
    signal?.addEventListener("abort", () => fail(signal.reason));
  });
  return { promise, resolve };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

let reads: Array<ReturnType<typeof deferred>>;
let writes: Array<ReturnType<typeof deferred>>;

beforeEach(() => {
  reads = [];
  writes = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      const next = deferred(init?.signal);
      (path === "/api/admin/state" ? reads : writes).push(next);
      return next.promise;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function loaded() {
  const hook = renderHook(() => useAdminState());
  await act(async () => reads[0]!.resolve(json(adminState())));
  return hook;
}

describe("the dashboard's polled state", () => {
  it("never lets an older read undo a switch just flipped", async () => {
    const { result } = await loaded();
    // A poll is on its way when the operator pauses videos.
    act(() => void result.current.refresh());
    let saved!: Promise<string | null>;
    act(() => {
      saved = result.current.change({ videosPaused: true });
    });
    expect(result.current.state?.controls.videosPaused).toBe(true);

    // The old read arrives late, from before the change: ignored.
    await act(async () => reads[1]!.resolve(json(adminState())));
    expect(result.current.state?.controls.videosPaused).toBe(true);

    await act(async () =>
      writes[0]!.resolve(
        json({ ok: true, controls: controls({ videosPaused: true }) }),
      ),
    );
    expect(await saved).toBeNull();
    expect(result.current.saving).toBe(false);
    // And the read after the change lands.
    await act(async () =>
      reads
        .at(-1)!
        .resolve(json(adminState({ videosPaused: true, videoDailyLimit: 5 }))),
    );
    expect(result.current.state?.controls).toMatchObject({
      videosPaused: true,
      videoDailyLimit: 5,
    });
  });

  it("rolls back only what failed, shows why, and re-reads", async () => {
    const { result } = await loaded();
    let saved!: Promise<string | null>;
    act(() => {
      saved = result.current.change({ videoAudience: "everyone" });
    });
    await act(async () =>
      writes[0]!.resolve(
        json({ error: "Saved, but could not read it back." }, 503),
      ),
    );
    expect(await saved).toBe("Saved, but could not read it back.");
    expect(result.current.saveError).toBe("Saved, but could not read it back.");
    expect(result.current.state?.controls.videoAudience).toBe("priority");
    // The re-read shows the change did save.
    await act(async () =>
      reads.at(-1)!.resolve(json(adminState({ videoAudience: "everyone" }))),
    );
    expect(result.current.state?.controls.videoAudience).toBe("everyone");
  });

  it("gives up on a read that hangs, so polls carry on", async () => {
    vi.useFakeTimers();
    renderHook(() => useAdminState());
    expect(reads).toHaveLength(1);
    // The read never answers; after ten seconds it is dropped.
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(reads).toHaveLength(2);
  });

  it("goes back to sign-in when a change finds the session gone", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      reload,
    });
    const { result } = await loaded();
    let saved!: Promise<string | null>;
    act(() => {
      saved = result.current.change({ videosPaused: true });
    });
    await act(async () =>
      writes[0]!.resolve(json({ error: "Sign in first." }, 401)),
    );
    await saved;
    expect(reload).toHaveBeenCalled();
  });

  it("re-reads soon after events, at most once every two seconds", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAdminState());
    await act(async () => reads[0]!.resolve(json(adminState())));
    for (let event = 0; event < 20; event++) result.current.refreshSoon();
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(reads).toHaveLength(2);
    await act(async () => reads[1]!.resolve(json(adminState())));
    // A burst right after waits for the two seconds to pass, then reads once.
    for (let event = 0; event < 20; event++) result.current.refreshSoon();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(reads).toHaveLength(2);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(reads).toHaveLength(3);
  });

  it("shows what the server sent back ahead of the next read", async () => {
    const { result } = await loaded();
    act(() => void result.current.refresh());
    const credit = { setUsd: 30, setAt: 7, spentUsd: 0 };
    act(() => result.current.apply({ claudeCredit: credit }));
    expect(result.current.state?.claudeCredit).toEqual(credit);
    // A read that started before does not put the old balance back.
    await act(async () => reads[1]!.resolve(json(adminState())));
    expect(result.current.state?.claudeCredit).toEqual(credit);
  });

  it("skips a poll while a read is already on its way", async () => {
    vi.useFakeTimers();
    renderHook(() => useAdminState());
    expect(reads).toHaveLength(1);
    act(() => vi.advanceTimersByTime(15_000));
    expect(reads).toHaveLength(1);
    await act(async () => reads[0]!.resolve(json(adminState())));
    await act(async () => undefined);
    act(() => vi.advanceTimersByTime(5_000));
    expect(reads).toHaveLength(2);
  });
});
