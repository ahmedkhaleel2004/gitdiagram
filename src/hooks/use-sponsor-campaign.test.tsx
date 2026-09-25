import type { ReactNode } from "react";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  SponsorCampaignProvider,
  useSponsorCampaign,
} from "./use-sponsor-campaign";
import { coderabbitCampaign, sentCampaign } from "~/lib/sponsor-campaign";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function rendered(campaignId: string | null) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SponsorCampaignProvider campaignId={campaignId}>
        {children}
      </SponsorCampaignProvider>
    );
  };
}

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

function setVisibility(state: DocumentVisibilityState) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
  document.dispatchEvent(new Event("visibilitychange"));
}

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
  const hook = renderHook(() => useSponsorCampaign(), {
    wrapper: rendered(sentCampaign.id),
  });
  await flush();
  expect(hook.result.current.campaign?.id).toBe(sentCampaign.id);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(hook.result.current).toMatchObject({
    campaign: { id: coderabbitCampaign.id },
    confirmed: true,
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("keeps the server-rendered campaign unconfirmed until the server answers, whatever the browser clock says", async () => {
  vi.useFakeTimers();
  // A browser clock after every campaign would otherwise remove the ad.
  vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json({}));
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(() => useSponsorCampaign(), {
    wrapper: rendered(sentCampaign.id),
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(hook.result.current).toMatchObject({
    campaign: { id: sentCampaign.id },
    confirmed: false,
  });
  // A bounded retry, not a busy loop.
  expect(fetcher).toHaveBeenCalledOnce();
  fetcher.mockResolvedValue(
    Response.json({
      campaignId: sentCampaign.id,
      serverTime: Date.parse("2026-09-24T12:00:00Z"),
      nextTransition: null,
    }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(hook.result.current).toMatchObject({
    campaign: { id: sentCampaign.id },
    confirmed: true,
  });
});

it("starts from the rendered campaign and only confirms it after the schedule check", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      campaignId: coderabbitCampaign.id,
      serverTime: Date.now(),
      nextTransition: null,
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(() => useSponsorCampaign(), {
    wrapper: rendered(sentCampaign.id),
  });
  expect(hook.result.current).toMatchObject({
    campaign: { id: sentCampaign.id },
    confirmed: false,
  });
  await flush();
  expect(hook.result.current).toMatchObject({
    campaign: { id: coderabbitCampaign.id },
    confirmed: true,
  });
});

it("checks once per tab and gives slots mounted later the confirmed campaign", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
    Response.json({
      campaignId: coderabbitCampaign.id,
      serverTime: Date.now(),
      nextTransition: Date.parse(coderabbitCampaign.endsAt),
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const seen: Array<{ id?: string; confirmed: boolean }> = [];
  function Slot() {
    const { campaign, confirmed } = useSponsorCampaign();
    seen.push({ id: campaign?.id, confirmed });
    return null;
  }
  // The layout's render-time pick is stale (a cached page from before the boundary).
  const view = render(
    <SponsorCampaignProvider campaignId={sentCampaign.id}>
      <Slot />
      <Slot />
    </SponsorCampaignProvider>,
  );
  await flush();
  seen.length = 0;
  view.rerender(
    <SponsorCampaignProvider campaignId={sentCampaign.id}>
      <Slot />
      <Slot />
      <Slot />
    </SponsorCampaignProvider>,
  );
  expect(seen.at(-1)).toEqual({ id: coderabbitCampaign.id, confirmed: true });
  expect(seen).not.toContainEqual(
    expect.objectContaining({ id: sentCampaign.id }),
  );
  expect(fetcher).toHaveBeenCalledOnce();
});

it("rechecks on tab focus at most once a minute, unless a boundary is near", async () => {
  vi.useFakeTimers();
  const boundary = Date.parse(coderabbitCampaign.startsAt);
  vi.setSystemTime(boundary - 10 * 60_000);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
    Response.json({
      campaignId: sentCampaign.id,
      serverTime: Date.now(),
      nextTransition: boundary,
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  renderHook(() => useSponsorCampaign(), { wrapper: rendered(null) });
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(1);
  setVisibility("visible");
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  setVisibility("visible");
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(2);
  // Within a minute of the boundary, every focus rechecks.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8 * 60_000 + 30_000);
  });
  setVisibility("visible");
  await flush();
  setVisibility("visible");
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("times out a hung check without AbortSignal.any and retries", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
  // Safari before 17.4 has no AbortSignal.any.
  vi.stubGlobal(
    "AbortSignal",
    Object.assign(Object.create(AbortSignal), { any: undefined }),
  );
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(
      (_, init) =>
        new Promise((_, reject) =>
          init!.signal!.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        ),
    );
  vi.stubGlobal("fetch", fetcher);
  renderHook(() => useSponsorCampaign(), { wrapper: rendered(null) });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
