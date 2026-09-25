export const websiteSponsorPlacements = ["home", "diagram", "browse"] as const;
export const sponsorPlacements = [
  ...websiteSponsorPlacements,
  "readme",
] as const;
export type SponsorPlacement = (typeof sponsorPlacements)[number];
export type WebsiteSponsorPlacement = (typeof websiteSponsorPlacements)[number];

export type SponsorCampaign = {
  id: string;
  sponsor: string;
  destination: string;
  utmCampaign: string;
  startsAt: string;
  endsAt: string;
  // The paid run's first day when it differs from `startsAt` (a lead-in).
  bookedFrom?: string;
};

// Keep completed campaigns here so links in older README revisions still work.
export const sentCampaign = {
  id: "sent-2026-09",
  sponsor: "Sent",
  destination: "https://www.sent.dm/en",
  utmCampaign: "sent_30_days",
  startsAt: "2026-09-19T22:23:01.236Z",
  endsAt: "2026-10-19T22:23:01.236Z",
} as const satisfies SponsorCampaign;

export const coderabbitCampaign = {
  id: "coderabbit-2026-10",
  sponsor: "CodeRabbit",
  destination: "https://www.coderabbit.ai/",
  utmCampaign: "coderabbit_30_days",
  // Complimentary lead-in after Sent; the booked run is Oct 20–Nov 18 Toronto.
  startsAt: sentCampaign.endsAt,
  endsAt: "2026-11-19T05:00:00.000Z",
  bookedFrom: "2026-10-20T04:00:00.000Z",
} as const satisfies SponsorCampaign;

export const scheduledSponsorCampaigns = [
  sentCampaign,
  coderabbitCampaign,
] as const;
export type ScheduledSponsorCampaign =
  (typeof scheduledSponsorCampaigns)[number];
export type SponsorCampaignId = ScheduledSponsorCampaign["id"];

export function findSponsorCampaign(
  id: string,
): ScheduledSponsorCampaign | undefined {
  return scheduledSponsorCampaigns.find((campaign) => campaign.id === id);
}

// Campaigns are exclusive: at most one is active at any moment, so the first
// match is the only match. The /advertise "shared website spot" (a 50/50
// rotation) is not implemented yet. Before booking one, add a rotation here and
// per-sponsor reporting; the schedule test rejects overlapping campaigns so an
// overlap cannot silently give the first campaign 100% of the traffic.
export function activeSponsorCampaign(now = Date.now()) {
  return scheduledSponsorCampaigns.find(
    ({ startsAt, endsAt }) =>
      now >= Date.parse(startsAt) && now < Date.parse(endsAt),
  );
}

export function nextSponsorTransition(now: number) {
  return scheduledSponsorCampaigns
    .flatMap(({ startsAt, endsAt }) => [
      Date.parse(startsAt),
      Date.parse(endsAt),
    ])
    .filter((timestamp) => timestamp > now)
    .sort((a, b) => a - b)[0];
}

// The last booked campaign that has not ended yet, which sets when new
// campaigns can start.
export function lastBookedSponsorCampaign(now = Date.now()) {
  return scheduledSponsorCampaigns
    .filter(({ endsAt }) => Date.parse(endsAt) > now)
    .sort((a, b) => Date.parse(b.endsAt) - Date.parse(a.endsAt))[0];
}

export function isProductionSponsorHost(hostname: string) {
  return ["gitdiagram.com", "www.gitdiagram.com"].includes(hostname);
}

export function sponsorClickHref(
  placement: SponsorPlacement,
  campaignId: string,
) {
  return `/out/${campaignId}?placement=${placement}`;
}
