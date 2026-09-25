import { StrictMode } from "react";
import { renderHook, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
import {
  trackSponsorPageView,
  useSponsorImpression,
} from "./use-sponsor-impression";

const capture = vi.fn<typeof fetch>();
const body = (call: number) =>
  JSON.parse(capture.mock.calls[call]![1]!.body as string) as {
    placement: string;
    pageViewId: string;
  };

beforeEach(() => {
  capture.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", capture);
  vi.stubGlobal("location", { hostname: "gitdiagram.com" });
  // Every test starts on a fresh page view.
  trackSponsorPageView("about:blank");
  route.pathname = "/";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("counts immediately on ad render without a visibility or duration threshold", () => {
  renderHook(() => useSponsorImpression("coderabbit-2026-10", "home"), {
    wrapper: StrictMode,
  });
  expect(capture).toHaveBeenCalledOnce();
  expect(capture.mock.calls[0]![0]).toBe("/out/coderabbit-2026-10/impression");
  expect(body(0)).toEqual({
    placement: "home",
    pageViewId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
});

it("counts new route loads and new campaigns, but not re-renders of the same ad", () => {
  const hook = renderHook(({ id }) => useSponsorImpression(id, "diagram"), {
    initialProps: { id: "sent-2026-09" },
  });
  hook.rerender({ id: "sent-2026-09" });
  expect(capture).toHaveBeenCalledOnce();
  route.pathname = "/vercel/next.js";
  hook.rerender({ id: "sent-2026-09" });
  expect(capture).toHaveBeenCalledTimes(2);
  hook.rerender({ id: "coderabbit-2026-10" });
  expect(capture).toHaveBeenCalledTimes(3);
  // One page-view ID per page view, shared by its impressions.
  expect(body(1).pageViewId).not.toBe(body(0).pageViewId);
  expect(body(2).pageViewId).toBe(body(1).pageViewId);
});

it("does not count a slot that unmounts and remounts on the same page", () => {
  // A browse search or sort, or a diagram regenerate, remounts the slot.
  const first = renderHook(() =>
    useSponsorImpression("sent-2026-09", "browse"),
  );
  first.unmount();
  renderHook(() => useSponsorImpression("sent-2026-09", "browse"));
  expect(capture).toHaveBeenCalledOnce();
  // Another placement on the same page is its own impression.
  renderHook(() => useSponsorImpression("sent-2026-09", "home"));
  expect(capture).toHaveBeenCalledTimes(2);
});

it("counts again after navigating away and back, even through a page without an ad", () => {
  const first = renderHook(() =>
    useSponsorImpression("sent-2026-09", "browse"),
  );
  first.unmount();
  // The provider reports every pathname change, including pages with no slot.
  trackSponsorPageView("/advertise");
  route.pathname = "/";
  renderHook(() => useSponsorImpression("sent-2026-09", "browse"));
  expect(capture).toHaveBeenCalledTimes(2);
  expect(body(1).pageViewId).not.toBe(body(0).pageViewId);
});

it("does not count empty inventory or preview visits", () => {
  renderHook(() => useSponsorImpression(undefined, "home"));
  vi.stubGlobal("location", {
    hostname: "gitdiagram-coderabbit-preview.vercel.app",
  });
  renderHook(() => useSponsorImpression("coderabbit-2026-10", "home"));
  expect(capture).not.toHaveBeenCalled();
});
