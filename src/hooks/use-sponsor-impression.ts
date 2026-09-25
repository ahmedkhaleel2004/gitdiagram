"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  isProductionSponsorHost,
  type WebsiteSponsorPlacement,
} from "~/lib/sponsor-campaign";

// Impressions are counted once per campaign and placement per page view. This
// state lives outside components, so a slot that unmounts and remounts on the
// same page (a browse search, a diagram regenerate, Strict Mode) is not a new
// impression. A page view is one visit to a pathname: query-string changes stay
// on it, and navigating to another pathname (then even back) starts a new one.
let pagePath: string | null | undefined;
let pageViewId: string | undefined;
const recorded = new Set<string>();

// Called by every impression and by the sponsor provider on each pathname
// change, so pages without a slot still end the previous page view.
export function trackSponsorPageView(pathname: string | null) {
  if (pathname === pagePath) return;
  pagePath = pathname;
  pageViewId = undefined;
  recorded.clear();
}

export function useSponsorImpression(
  campaignId: string | undefined,
  placement: WebsiteSponsorPlacement,
) {
  const pathname = usePathname();

  useEffect(() => {
    trackSponsorPageView(pathname);
    if (
      !campaignId ||
      !isProductionSponsorHost(location.hostname) ||
      navigator.doNotTrack === "1" ||
      (navigator as Navigator & { globalPrivacyControl?: boolean })
        .globalPrivacyControl
    )
      return;

    // Count when the ad renders, including below the fold. No visibility delay.
    const key = `${campaignId}:${placement}`;
    if (recorded.has(key)) return;
    recorded.add(key);
    // Created lazily: randomUUID needs a secure context (not a LAN dev URL).
    pageViewId ??= crypto.randomUUID();
    void fetch(`/out/${campaignId}/impression`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placement, pageViewId }),
      keepalive: true,
    }).catch(() => {});
  }, [campaignId, placement, pathname]);
}
