"use client";

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import {
  activeSponsorCampaign,
  findSponsorCampaign,
} from "~/lib/sponsor-campaign";
import { trackSponsorPageView } from "~/hooks/use-sponsor-impression";

type SponsorSchedule = { campaignId: string | null; confirmed: boolean };

const SponsorScheduleContext = createContext<SponsorSchedule>({
  campaignId: null,
  confirmed: false,
});

const REQUEST_TIMEOUT_MS = 5_000;
const RETRY_MS = 30_000;
// Tab focus rechecks at most this often, unless a boundary is this close.
const FOCUS_RECHECK_MS = 60_000;
const MAX_TIMER_MS = 2_147_483_647;

// One schedule per tab. The layout renders the campaign scheduled at render
// time, so the banner is in the first HTML instead of appearing after
// hydration. That HTML may be cached, so the campaign is only `confirmed` after
// a check against server time (independent of page/CDN caches and browser
// clocks). Slots read this state, so one mounted later starts from the
// confirmed campaign rather than the render-time one.
export function SponsorCampaignProvider({
  campaignId,
  children,
}: {
  campaignId: string | null;
  children: ReactNode;
}) {
  const [schedule, setSchedule] = useState<SponsorSchedule>({
    campaignId,
    confirmed: false,
  });
  const pathname = usePathname();

  useEffect(() => {
    trackSponsorPageView(pathname);
  }, [pathname]);

  useEffect(() => {
    const confirm = (campaignId: string | null) =>
      setSchedule({ campaignId, confirmed: true });
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    // Unknown until the server answers once; the browser clock is never trusted.
    let serverOffset: number | undefined;
    let nextTransition: number | null = null;
    let lastAttempt = 0;
    const serverNow = (offset: number) => Date.now() + offset;

    async function refresh() {
      clearTimeout(timer);
      controller?.abort();
      const attempt = new AbortController();
      controller = attempt;
      lastAttempt = Date.now();
      // One controller with a timer: AbortSignal.any needs Safari 17.4+.
      const timeout = setTimeout(() => attempt.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch("/api/sponsor", {
          cache: "no-store",
          signal: attempt.signal,
        });
        if (!response.ok) throw new Error("Sponsor schedule unavailable");
        const data = (await response.json()) as {
          campaignId: string | null;
          serverTime: number;
          nextTransition: number | null;
        };
        if (
          !Number.isFinite(data.serverTime) ||
          (data.nextTransition !== null &&
            !Number.isFinite(data.nextTransition)) ||
          (data.campaignId !== null && !findSponsorCampaign(data.campaignId))
        )
          throw new Error("Invalid sponsor schedule");
        if (stopped) return;
        const offset = data.serverTime - Date.now();
        serverOffset = offset;
        nextTransition = data.nextTransition;
        confirm(data.campaignId);
        if (data.nextTransition !== null) {
          timer = setTimeout(
            () => {
              // Switch at the boundary even if the subsequent request fails.
              confirm(activeSponsorCampaign(serverNow(offset))?.id ?? null);
              void refresh();
            },
            Math.min(
              Math.max(1, data.nextTransition - data.serverTime),
              MAX_TIMER_MS,
            ),
          );
        }
      } catch {
        // A newer request replaced this one; a timeout still retries below.
        if (stopped || controller !== attempt) return;
        // Once server time is known, follow the schedule on the server clock.
        // Before that, keep the server-rendered campaign unconfirmed.
        if (serverOffset !== undefined)
          confirm(activeSponsorCampaign(serverNow(serverOffset))?.id ?? null);
        timer = setTimeout(() => void refresh(), RETRY_MS);
      } finally {
        clearTimeout(timeout);
      }
    }

    function onVisible() {
      if (document.visibilityState !== "visible") return;
      const nearBoundary =
        serverOffset !== undefined &&
        nextTransition !== null &&
        serverNow(serverOffset) >= nextTransition - FOCUS_RECHECK_MS;
      if (nearBoundary || Date.now() - lastAttempt >= FOCUS_RECHECK_MS)
        void refresh();
    }
    void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return createElement(SponsorScheduleContext, { value: schedule }, children);
}

export function useSponsorCampaign() {
  const { campaignId, confirmed } = useContext(SponsorScheduleContext);
  return {
    campaign: campaignId ? findSponsorCampaign(campaignId) : undefined,
    confirmed,
  };
}
