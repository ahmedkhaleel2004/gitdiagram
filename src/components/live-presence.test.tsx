import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeSocket, setVisibility } from "~/app/admin/test-socket";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

async function mount() {
  const { LivePresence } = await import("./live-presence");
  const view = render(<LivePresence />);
  return {
    navigate(pathname: string) {
      navigation.pathname = pathname;
      view.rerender(<LivePresence />);
    },
  };
}

const params = (socket: FakeSocket | undefined) =>
  new URL(socket!.url).searchParams;

/** Lets the page go idle, which is when the tab first connects. */
const idle = () => act(() => vi.advanceTimersByTime(1_500));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_PRESENCE_URL", "wss://presence.example.dev");
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  FakeSocket.reset();
  navigation.pathname = "/";
  localStorage.clear();
  sessionStorage.clear();
  setVisibility("visible");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("live presence", () => {
  it("connects once the page is idle, as one browser", async () => {
    await mount();
    expect(FakeSocket.instances).toHaveLength(0);
    idle();
    const query = params(FakeSocket.last);
    expect(query.get("p")).toBe("/");
    expect(query.get("v")).toBe("1");
    expect(query.get("b")).toBe(localStorage.getItem("gd-presence-id"));
  });

  it("waits until a tab opened in the background is looked at", async () => {
    setVisibility("hidden");
    await mount();
    idle();
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeSocket.instances).toHaveLength(0);
    act(() => setVisibility("visible"));
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("sends the page and visibility that changed while connecting", async () => {
    const page = await mount();
    idle();
    const socket = FakeSocket.last!;
    page.navigate("/acme/app");
    act(() => setVisibility("hidden"));
    expect(socket.sent).toEqual([]);
    act(() => socket.open());
    expect(socket.sent).toEqual(["p:/acme/app", "v:0"]);
  });

  it("stays out of automated browsers", async () => {
    Object.defineProperty(navigator, "webdriver", {
      configurable: true,
      get: () => true,
    });
    try {
      await mount();
      idle();
      expect(FakeSocket.instances).toHaveLength(0);
    } finally {
      delete (navigator as { webdriver?: boolean }).webdriver;
    }
  });

  it("keeps one id per tab when localStorage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
      this: Storage,
    ) {
      if (this === localStorage) throw new Error("blocked");
      return null;
    });
    await mount();
    idle();
    const first = params(FakeSocket.last).get("b");
    expect(first).toMatch(/^[a-z0-9]{8,24}$/);
    act(() => FakeSocket.last!.drop());
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeSocket.instances.length).toBeGreaterThan(1);
    expect(params(FakeSocket.last).get("b")).toBe(first);
  });

  it("spreads reconnects out, and starts over on the next page after giving up", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const page = await mount();
    idle();
    act(() => FakeSocket.last!.drop());
    // First retry: 4 s spread to between 2 and 6 s.
    act(() => vi.advanceTimersByTime(1_999));
    expect(FakeSocket.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeSocket.instances).toHaveLength(2);
    random.mockRestore();

    for (let attempt = 0; attempt < 10; attempt++) {
      act(() => FakeSocket.last!.drop());
      act(() => vi.advanceTimersByTime(120_000));
    }
    const gaveUp = FakeSocket.instances.length;
    act(() => vi.advanceTimersByTime(600_000));
    expect(FakeSocket.instances).toHaveLength(gaveUp);
    page.navigate("/about");
    expect(FakeSocket.instances).toHaveLength(gaveUp + 1);
  });

  it("disconnects on the operator's own pages", async () => {
    const page = await mount();
    idle();
    const socket = FakeSocket.last!;
    act(() => socket.open());
    page.navigate("/admin");
    expect(socket.closedWith).toBe(1000);
  });
});
