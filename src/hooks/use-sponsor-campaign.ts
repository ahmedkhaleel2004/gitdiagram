"use client";

import { useEffect, useState } from "react";
import {
  activeSponsorCampaign,
  findSponsorCampaign,
} from "~/lib/sponsor-campaign";

// Resolve against server time, independently of page/CDN caches or browser clocks.
export function useSponsorCampaign() {
  const [campaignId, setCampaignId] = useState<string | null>(null);

  useEffect(() => {
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

  return campaignId ? findSponsorCampaign(campaignId) : undefined;
}
