import { StrictMode } from "react";
import { renderHook, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
import { useSponsorImpression } from "./use-sponsor-impression";

const capture = vi.fn<typeof fetch>();
beforeEach(() => {
  capture.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", capture);
  vi.stubGlobal("location", { hostname: "gitdiagram.com" });
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
  expect(JSON.parse(capture.mock.calls[0]![1]!.body as string)).toMatchObject({
    placement: "home",
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
});

it("does not count empty inventory or preview visits", () => {
  renderHook(() => useSponsorImpression(undefined, "home"));
  vi.stubGlobal("location", {
    hostname: "gitdiagram-coderabbit-preview.vercel.app",
  });
  renderHook(() => useSponsorImpression("coderabbit-2026-10", "home"));
  expect(capture).not.toHaveBeenCalled();
});
