import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminState, LiveControls } from "~/features/admin/types";
import { useAdminState } from "./use-admin-state";

const controls = (overrides: Partial<LiveControls> = {}): LiveControls => ({
  videoAudience: "priority",
  videosPaused: false,
  videoDailyLimit: null,
  videoPersonDailyLimit: null,
  videoNetworkDailyLimit: null,
  ...overrides,
});

const adminState = (overrides: Partial<LiveControls> = {}): AdminState => ({
  now: 0,
  controls: controls(overrides),
  video: null,
  voiceCredits: null,
  claudeCredit: null,
  diagramQuota: null,
  presence: null,
  deployment: { commit: null, region: null },
});

/** A response the test hands back whenever it likes. */
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
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
    vi.fn((path: string) => {
      const next = deferred();
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
