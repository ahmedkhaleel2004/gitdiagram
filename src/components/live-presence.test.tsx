import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HIDDEN_REPORT_MS, MAX_PATH } from "~/features/admin/presence-protocol";
import { FakeSocket, setVisibility } from "~/test/fake-socket";

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

/** What a tab told the worker, leaving out its keep-alive pings. */
const told = (socket: FakeSocket) =>
  socket.sent.filter((message) => message !== "ping");

/** Keeps the tab in view long enough for it to connect. */
const idle = () => act(() => vi.advanceTimersByTime(15_000));

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
  it("connects once the tab has been in view a while, as one browser", async () => {
    await mount();
    act(() => vi.advanceTimersByTime(14_999));
    expect(FakeSocket.instances).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1));
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
    idle();
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("counts time in view across looks, and never connects for a quick visit", async () => {
    await mount();
    act(() => vi.advanceTimersByTime(10_000));
    act(() => setVisibility("hidden"));
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeSocket.instances).toHaveLength(0);
    act(() => setVisibility("visible"));
    act(() => vi.advanceTimersByTime(4_999));
    expect(FakeSocket.instances).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("sends the page and visibility that changed while connecting", async () => {
    const page = await mount();
    idle();
    const socket = FakeSocket.last!;
    page.navigate("/acme/app");
    act(() => setVisibility("hidden"));
    expect(told(socket)).toEqual([]);
    act(() => socket.open());
    expect(told(socket)).toEqual(["p:/acme/app"]);
    act(() => vi.advanceTimersByTime(HIDDEN_REPORT_MS));
    expect(told(socket)).toEqual(["p:/acme/app", "v:0"]);
  });

  it("says it went out of view only after a while, so a quick look away sends nothing", async () => {
    await mount();
    idle();
    const socket = FakeSocket.last!;
    act(() => socket.open());
    act(() => setVisibility("hidden"));
    act(() => vi.advanceTimersByTime(HIDDEN_REPORT_MS - 1));
    act(() => setVisibility("visible"));
    act(() => vi.advanceTimersByTime(HIDDEN_REPORT_MS * 2));
    expect(told(socket)).toEqual([]);
    act(() => setVisibility("hidden"));
    act(() => vi.advanceTimersByTime(HIDDEN_REPORT_MS));
    expect(told(socket)).toEqual(["v:0"]);
    act(() => setVisibility("visible"));
    expect(told(socket)).toEqual(["v:0", "v:1"]);
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
    // First retry: between 2 and 4 s.
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

  it("lets a waiting retry run instead of reconnecting on every page", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const page = await mount();
    idle();
    act(() => FakeSocket.last!.drop());
    // Down, with a retry due in 2 s: moving around the site does not jump it.
    page.navigate("/acme/app");
    page.navigate("/about");
    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    expect(FakeSocket.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(2_000));
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("disconnects on the operator's own pages, and comes back after", async () => {
    const page = await mount();
    idle();
    const socket = FakeSocket.last!;
    act(() => socket.open());
    page.navigate("/admin");
    expect(socket.closedWith).toBe(1000);
    // Closed on purpose: no retry while there.
    act(() => vi.advanceTimersByTime(600_000));
    expect(FakeSocket.instances).toHaveLength(1);
    page.navigate("/");
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("sends only the referring site's origin", async () => {
    const referrer = vi
      .spyOn(document, "referrer", "get")
      .mockReturnValue("https://news.example.com/item?id=42#top");
    await mount();
    idle();
    expect(params(FakeSocket.last).get("r")).toBe("https://news.example.com");
    referrer.mockReturnValue("not a url");
    act(() => FakeSocket.last!.drop(1000));
    act(() => vi.advanceTimersByTime(120_000));
    expect(params(FakeSocket.last).get("r")).toBe("");
  });

  it("only reports what changed, and paths no longer than the worker keeps", async () => {
    const page = await mount();
    idle();
    const socket = FakeSocket.last!;
    act(() => socket.open());
    // Visibility events that change nothing (as some browsers repeat them).
    act(() => setVisibility("visible"));
    act(() => setVisibility("visible"));
    expect(told(socket)).toEqual([]);
    act(() => setVisibility("hidden"));
    act(() => vi.advanceTimersByTime(HIDDEN_REPORT_MS / 2));
    act(() => setVisibility("hidden"));
    act(() => vi.advanceTimersByTime(HIDDEN_REPORT_MS / 2));
    expect(told(socket)).toEqual(["v:0"]);
    const long = `/${"x".repeat(MAX_PATH + 50)}`;
    page.navigate(long);
    expect(told(socket)).toEqual(["v:0", `p:${long.slice(0, MAX_PATH)}`]);
  });
});
