export const sponsorPlacements = [
  "home",
  "diagram",
  "browse",
  "readme",
] as const;
export type SponsorPlacement = (typeof sponsorPlacements)[number];

// Keep completed campaigns here so links in older README revisions still work.
export const sentCampaign = {
  id: "sent-2026-09",
  sponsor: "Sent",
  destination: "https://www.sent.dm/en",
  utmCampaign: "sent_30_days",
} as const;

export function sponsorClickHref(placement: SponsorPlacement) {
  return `/out/${sentCampaign.id}?placement=${placement}`;
}
