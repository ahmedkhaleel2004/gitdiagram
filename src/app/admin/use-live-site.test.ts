import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_PROTOCOL,
  DASHBOARD_TOKEN_MS,
  PRESENCE_PROTOCOL,
} from "~/features/admin/presence-protocol";
import { FakeSocket, setVisibility } from "~/test/fake-socket";
import { useLiveSite } from "./use-live-site";

const SIG = "b".repeat(64);
const URL = "wss://presence.example.dev";
const token = (msFromNow: number) => `${Date.now() + msFromNow}.${SIG}`;

function setup(initialToken = token(600_000)) {
  const onEvent = vi.fn();
  const onTokenNeeded = vi.fn();
  const hook = renderHook(
    ({ presence }) => useLiveSite(presence, { onEvent, onTokenNeeded }),
    { initialProps: { presence: { url: URL, token: initialToken } } },
  );
  return { ...hook, onEvent, onTokenNeeded };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.reset();
  vi.stubGlobal("WebSocket", FakeSocket);
  setVisibility("visible");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the dashboard's live socket", () => {
  it("sends its token as a subprotocol, never in the URL", () => {
    const current = token(600_000);
    setup(current);
    expect(FakeSocket.last?.url).toBe(`${URL}/admin`);
    expect(FakeSocket.last?.protocols).toEqual([ADMIN_PROTOCOL, current]);
  });

  it("backs off instead of retrying every second, and asks for a new token", () => {
    const { onTokenNeeded } = setup();
    // Refused (say, 403) ten times in a row.
    for (let attempt = 0; attempt < 10; attempt++) {
      act(() => FakeSocket.last!.drop());
      act(() => vi.advanceTimersByTime(60_000));
    }
    expect(onTokenNeeded).toHaveBeenCalled();
    const before = FakeSocket.instances.length;
    // Backed off by now: at most one try in the next 30 seconds.
    act(() => FakeSocket.last!.drop());
    act(() => vi.advanceTimersByTime(29_000));
    expect(FakeSocket.instances.length - before).toBeLessThanOrEqual(1);
  });

  it("starts the waits over once it connects again", () => {
    setup();
    for (let attempt = 0; attempt < 6; attempt++) {
      act(() => FakeSocket.last!.drop());
      act(() => vi.advanceTimersByTime(60_000));
    }
    act(() => FakeSocket.last!.open());
    const count = FakeSocket.instances.length;
    act(() => FakeSocket.last!.drop());
    act(() => vi.advanceTimersByTime(2_000));
    expect(FakeSocket.instances.length).toBe(count + 1);
  });

  it("does not retry while hidden, and reconnects when shown", () => {
    const { result } = setup();
    act(() => FakeSocket.last!.open());
    expect(result.current.status).toBe("live");
    act(() => setVisibility("hidden"));
    act(() => FakeSocket.last!.drop());
    const count = FakeSocket.instances.length;
    act(() => vi.advanceTimersByTime(4 * 60_000));
    expect(FakeSocket.instances.length).toBe(count);
    act(() => setVisibility("visible"));
    expect(FakeSocket.instances.length).toBe(count + 1);
  });

  it("fetches a fresh token instead of connecting with an expired one", () => {
    const { rerender, onTokenNeeded } = setup(token(-1_000));
    expect(FakeSocket.instances).toHaveLength(0);
    expect(onTokenNeeded).toHaveBeenCalledTimes(1);
    const fresh = token(600_000);
    rerender({ presence: { url: URL, token: fresh } });
    expect(FakeSocket.last?.protocols).toEqual([ADMIN_PROTOCOL, fresh]);
  });

  it("hands a newer token to the open socket before its own runs out", () => {
    const { rerender, onTokenNeeded } = setup(token(DASHBOARD_TOKEN_MS));
    const socket = FakeSocket.last!;
    act(() => socket.open());
    act(() => vi.advanceTimersByTime(5_000));
    act(() => socket.receive("pong"));
    socket.sent = []; // the ping
    // Polls bring new tokens every few seconds: not worth a message yet.
    rerender({ presence: { url: URL, token: token(DASHBOARD_TOKEN_MS) } });
    expect(socket.sent).toEqual([]);
    for (let second = 5; second < 20; second += 5) {
      act(() => vi.advanceTimersByTime(5_000));
      act(() => socket.receive("pong"));
    }
    socket.sent = []; // the pings
    const newer = token(DASHBOARD_TOKEN_MS);
    rerender({ presence: { url: URL, token: newer } });
    expect(FakeSocket.last?.sent).toEqual([`t:${newer}`]);
    expect(FakeSocket.instances).toHaveLength(1);
    // A newer token was on hand all along: no need to ask for one.
    expect(onTokenNeeded).not.toHaveBeenCalled();
  });

  it("asks for a token itself while hidden, when polls stop bringing them", () => {
    const first = token(DASHBOARD_TOKEN_MS);
    const { rerender, onTokenNeeded } = setup(first);
    const socket = FakeSocket.last!;
    act(() => socket.open());
    act(() => setVisibility("hidden"));
    for (let second = 0; second < 15; second += 5) {
      act(() => vi.advanceTimersByTime(5_000));
      act(() => socket.receive("pong"));
    }
    expect(onTokenNeeded).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5_000));
    expect(onTokenNeeded).toHaveBeenCalled();
    socket.sent = [];
    const newer = token(DASHBOARD_TOKEN_MS);
    rerender({ presence: { url: URL, token: newer } });
    expect(socket.sent).toEqual([`t:${newer}`]);
  });

  it("says when the worker speaks another protocol version", () => {
    const { result } = setup();
    act(() => FakeSocket.last!.open());
    expect(result.current.protocolMismatch).toBe(false);
    const snapshot = {
      type: "snapshot",
      now: Date.now(),
      visitors: [],
      events: [],
      jobs: [],
      peak: { day: "2027-01-15", count: 0, at: 0 },
    };
    act(() =>
      FakeSocket.last!.receive({ ...snapshot, protocol: PRESENCE_PROTOCOL }),
    );
    expect(result.current.protocolMismatch).toBe(false);
    // A worker deployed before protocol versions existed.
    act(() => FakeSocket.last!.receive(snapshot));
    expect(result.current.protocolMismatch).toBe(true);
  });

  it("notices a connection that died without closing", () => {
    const { result } = setup();
    const first = FakeSocket.last!;
    act(() => first.open());
    act(() => vi.advanceTimersByTime(5_000));
    expect(first.sent).toEqual(["ping"]);
    act(() => first.receive("pong"));
    expect(result.current.latency).not.toBeNull();
    // Asleep: pings go unanswered.
    act(() => vi.advanceTimersByTime(20_000));
    expect(first.closedWith).not.toBeNull();
    expect(result.current.status).toBe("offline");
    act(() => vi.advanceTimersByTime(2_000));
    expect(FakeSocket.instances.length).toBeGreaterThan(1);
  });

  it("applies what the worker pushes and passes events on", () => {
    const { result, onEvent } = setup();
    act(() => FakeSocket.last!.open());
    act(() =>
      FakeSocket.last!.receive({
        type: "snapshot",
        now: Date.now(),
        visitors: [],
        events: [],
        jobs: [],
        peak: { day: "2027-01-15", count: 2, at: 0 },
      }),
    );
    const event = { id: 7, at: Date.now(), kind: "video.started" };
    act(() => FakeSocket.last!.receive({ type: "event", event }));
    expect(result.current.peak?.count).toBe(2);
    expect(result.current.events).toHaveLength(1);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  });
});
