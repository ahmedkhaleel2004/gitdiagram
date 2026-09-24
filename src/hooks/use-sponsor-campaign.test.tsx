import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSponsorCampaign } from "./use-sponsor-campaign";
import { coderabbitCampaign, sentCampaign } from "~/lib/sponsor-campaign";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("uses server time despite a wrong browser clock and hands over in an already open page", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  const boundary = Date.parse(coderabbitCampaign.startsAt);
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        campaignId: sentCampaign.id,
        serverTime: boundary - 100,
        nextTransition: boundary,
      }),
    )
    .mockRejectedValue(new Error("offline at handoff"));
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(() => useSponsorCampaign());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(hook.result.current?.id).toBe(sentCampaign.id);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(hook.result.current?.id).toBe(coderabbitCampaign.id);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("handles invalid schedule responses with a bounded retry instead of a busy loop", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json({}));
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(() => useSponsorCampaign());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(hook.result.current?.id).toBe(sentCampaign.id);
  expect(fetcher).toHaveBeenCalledOnce();
});
