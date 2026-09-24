"use client";

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  activeSponsorCampaign,
  findSponsorCampaign,
} from "~/lib/sponsor-campaign";

const InitialSponsorCampaignContext = createContext<string | null>(null);

// The layout renders the campaign scheduled at render time, so the banner is in
// the first HTML instead of appearing after hydration and a network round trip.
export function InitialSponsorCampaignProvider({
  campaignId,
  children,
}: {
  campaignId: string | null;
  children: ReactNode;
}) {
  return createElement(
    InitialSponsorCampaignContext,
    { value: campaignId },
    children,
  );
}

// Resolve against server time, independently of page/CDN caches or browser clocks.
// The rendered campaign may be stale, so it is only `confirmed` after that check.
export function useSponsorCampaign() {
  const initialCampaignId = useContext(InitialSponsorCampaignContext);
  const [schedule, setSchedule] = useState({
    campaignId: initialCampaignId,
    confirmed: false,
  });

  useEffect(() => {
    const setCampaignId = (campaignId: string | null) =>
      setSchedule({ campaignId, confirmed: true });
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    let serverOffset = 0;

    async function refresh() {
      clearTimeout(timer);
      controller?.abort();
      const attempt = new AbortController();
      controller = attempt;
      try {
        const response = await fetch("/api/sponsor", {
          cache: "no-store",
          signal: AbortSignal.any([attempt.signal, AbortSignal.timeout(5000)]),
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
        serverOffset = data.serverTime - Date.now();
        setCampaignId(data.campaignId);
        if (data.nextTransition !== null) {
          timer = setTimeout(
            () => {
              // Switch at the boundary even if the subsequent request fails.
              setCampaignId(
                activeSponsorCampaign(Date.now() + serverOffset)?.id ?? null,
              );
              void refresh();
            },
            Math.min(
              Math.max(1, data.nextTransition - data.serverTime),
              2_147_483_647,
            ),
          );
        }
      } catch {
        if (stopped || attempt.signal.aborted) return;
        setCampaignId(
          activeSponsorCampaign(Date.now() + serverOffset)?.id ?? null,
        );
        timer = setTimeout(() => void refresh(), 30_000);
      }
    }

    function onVisible() {
      if (document.visibilityState === "visible") void refresh();
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

  return {
    campaign: schedule.campaignId
      ? findSponsorCampaign(schedule.campaignId)
      : undefined,
    confirmed: schedule.confirmed,
  };
}
