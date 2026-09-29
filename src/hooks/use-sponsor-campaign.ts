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
  activeSponsorCampaigns,
  findSponsorCampaign,
  pickSponsorCampaign,
} from "~/lib/sponsor-campaign";
import { trackSponsorPageView } from "~/hooks/use-sponsor-impression";

type SponsorSchedule = {
  campaignIds: readonly string[];
  confirmed: boolean;
  rotation: number;
};

const SponsorScheduleContext = createContext<SponsorSchedule>({
  campaignIds: [],
  confirmed: false,
  rotation: 0,
});

const REQUEST_TIMEOUT_MS = 5_000;
const RETRY_MS = 30_000;
// Tab focus rechecks at most this often, unless a boundary is this close.
const FOCUS_RECHECK_MS = 60_000;
const MAX_TIMER_MS = 2_147_483_647;

// One schedule per tab. The layout renders the campaigns scheduled at render
// time, so the banner is in the first HTML instead of appearing after
// hydration. That HTML may be cached, so the campaigns are only `confirmed`
// after a check against server time (independent of page/CDN caches and
// browser clocks). Slots read this state, so one mounted later starts from the
// confirmed campaigns rather than the render-time ones. `rotation` is the
// render's hour and stays fixed for the tab, so the rotation never swaps an ad
// already on screen; visitors arriving at different times spread it evenly.
export function SponsorCampaignProvider({
  campaignIds,
  rotation,
  children,
}: {
  campaignIds: readonly string[];
  rotation: number;
  children: ReactNode;
}) {
  const [schedule, setSchedule] = useState<SponsorSchedule>({
    campaignIds,
    confirmed: false,
    rotation,
  });
  const pathname = usePathname();

  useEffect(() => {
    trackSponsorPageView(pathname);
  }, [pathname]);

  useEffect(() => {
    const confirm = (campaignIds: readonly string[]) =>
      setSchedule((current) => ({ ...current, campaignIds, confirmed: true }));
    const activeAt = (now: number) =>
      activeSponsorCampaigns(now).map(({ id }) => id);
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
          campaignIds: unknown;
          serverTime: number;
          nextTransition: number | null;
        };
        if (
          !Number.isFinite(data.serverTime) ||
          (data.nextTransition !== null &&
            !Number.isFinite(data.nextTransition)) ||
          !Array.isArray(data.campaignIds) ||
          !data.campaignIds.every(
            (id) => typeof id === "string" && findSponsorCampaign(id),
          )
        )
          throw new Error("Invalid sponsor schedule");
        if (stopped) return;
        const offset = data.serverTime - Date.now();
        serverOffset = offset;
        nextTransition = data.nextTransition;
        confirm(data.campaignIds as string[]);
        if (data.nextTransition !== null) {
          timer = setTimeout(
            () => {
              // Switch at the boundary even if the subsequent request fails.
              confirm(activeAt(serverNow(offset)));
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
          confirm(activeAt(serverNow(serverOffset)));
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

// The one campaign this page view shows; every slot on the page agrees.
export function useSponsorCampaign() {
  const { campaignIds, confirmed, rotation } = useContext(
    SponsorScheduleContext,
  );
  const pathname = usePathname();
  const campaigns = campaignIds.flatMap((id) => findSponsorCampaign(id) ?? []);
  return {
    campaign: pickSponsorCampaign(campaigns, pathname ?? "/", rotation),
    confirmed,
  };
}
