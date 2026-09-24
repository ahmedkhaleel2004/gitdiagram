"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  isProductionSponsorHost,
  type WebsiteSponsorPlacement,
} from "~/lib/sponsor-campaign";

export function useSponsorImpression(
  campaignId: string | undefined,
  placement: WebsiteSponsorPlacement,
) {
  const pathname = usePathname();
  const lastRecorded = useRef<string | null>(null);

  useEffect(() => {
    if (
      !campaignId ||
      !isProductionSponsorHost(location.hostname) ||
      navigator.doNotTrack === "1" ||
      (navigator as Navigator & { globalPrivacyControl?: boolean })
        .globalPrivacyControl
    )
      return;

    // Count when the ad renders, including below the fold. No visibility delay.
    // The ref prevents React Strict Mode's effect replay from double-counting.
    const key = `${campaignId}:${placement}:${pathname}`;
    if (lastRecorded.current === key) return;
    lastRecorded.current = key;
    void fetch(`/out/${campaignId}/impression`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placement, eventId: crypto.randomUUID() }),
      keepalive: true,
    }).catch(() => {});
  }, [campaignId, placement, pathname]);
}
