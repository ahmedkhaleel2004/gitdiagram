export const sponsorPlacements = [
  "home",
  "diagram",
  "browse",
  "readme",
] as const;
export type SponsorPlacement = (typeof sponsorPlacements)[number];
export type WebsiteSponsorPlacement = Exclude<SponsorPlacement, "readme">;

export type SponsorCampaign = {
  id: string;
  sponsor: string;
  destination: string;
  utmCampaign: string;
  startsAt: string;
  endsAt: string;
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
} as const satisfies SponsorCampaign;

const sponsorCampaigns: readonly SponsorCampaign[] = [
  sentCampaign,
  coderabbitCampaign,
];

export function findSponsorCampaign(id: string) {
  return sponsorCampaigns.find((campaign) => campaign.id === id);
}

export function activeSponsorCampaign(now = Date.now()) {
  return sponsorCampaigns.find(
    ({ startsAt, endsAt }) =>
      now >= Date.parse(startsAt) && now < Date.parse(endsAt),
  );
}

export function nextSponsorTransition(now: number) {
  return sponsorCampaigns
    .flatMap(({ startsAt, endsAt }) => [
      Date.parse(startsAt),
      Date.parse(endsAt),
    ])
    .filter((timestamp) => timestamp > now)
    .sort((a, b) => a - b)[0];
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
