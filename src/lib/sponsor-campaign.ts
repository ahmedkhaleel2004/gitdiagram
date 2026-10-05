export const websiteSponsorPlacements = ["home", "diagram", "browse"] as const;
export const sponsorPlacements = [
  ...websiteSponsorPlacements,
  "readme",
] as const;
export type SponsorPlacement = (typeof sponsorPlacements)[number];
export type WebsiteSponsorPlacement = (typeof websiteSponsorPlacements)[number];

// Exclusive: the only advertiser everywhere, README included. Shared: one of at
// most two advertisers rotating on the website placements (no README).
export type SponsorPackage = "exclusive" | "shared";

export type SponsorCampaign = {
  id: string;
  sponsor: string;
  package: SponsorPackage;
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
  package: "exclusive",
  destination: "https://www.sent.dm/en",
  utmCampaign: "sent_30_days",
  startsAt: "2026-09-19T22:23:01.236Z",
  endsAt: "2026-10-19T22:23:01.236Z",
} as const satisfies SponsorCampaign;

export const coderabbitCampaign = {
  id: "coderabbit-2026-10",
  sponsor: "CodeRabbit",
  package: "exclusive",
  destination: "https://www.coderabbit.ai/",
  utmCampaign: "coderabbit_30_days",
  // Complimentary lead-in after Sent; the booked run is Oct 20–Nov 18 Toronto.
  startsAt: sentCampaign.endsAt,
  endsAt: "2026-11-19T05:00:00.000Z",
  bookedFrom: "2026-10-20T04:00:00.000Z",
} as const satisfies SponsorCampaign;

// Paid October 5, 2026: a shared website spot, November 19–December 19 Toronto.
export const nangoCampaign = {
  id: "nango-2026-11",
  sponsor: "Nango",
  package: "shared",
  // Nango's own tracking link; its UTM tags are kept as sent.
  destination:
    "https://nango.dev/?utm_source=gitdiagram&utm_medium=display&utm_campaign=rotating_ad",
  utmCampaign: "rotating_ad",
  startsAt: coderabbitCampaign.endsAt,
  endsAt: "2026-12-19T05:00:00.000Z",
} as const satisfies SponsorCampaign;

export const scheduledSponsorCampaigns = [
  sentCampaign,
  coderabbitCampaign,
  nangoCampaign,
] as const;
export type ScheduledSponsorCampaign =
  (typeof scheduledSponsorCampaigns)[number];
export type SponsorCampaignId = ScheduledSponsorCampaign["id"];
// A scheduled campaign's ID with any dates and package (for what-if checks).
export type BookedSponsorCampaign = SponsorCampaign & { id: SponsorCampaignId };

export function findSponsorCampaign(
  id: string,
): ScheduledSponsorCampaign | undefined {
  return scheduledSponsorCampaigns.find((campaign) => campaign.id === id);
}

// At most two shared campaigns overlap, and an exclusive one overlaps nothing
// (sponsor-campaign.test.ts enforces both). Ordered by ID so the server and
// every browser agree on the rotation.
export function activeSponsorCampaigns<
  T extends SponsorCampaign = ScheduledSponsorCampaign,
>(
  now = Date.now(),
  campaigns: readonly T[] = scheduledSponsorCampaigns as readonly SponsorCampaign[] as readonly T[],
): T[] {
  return campaigns
    .filter(
      ({ startsAt, endsAt }) =>
        now >= Date.parse(startsAt) && now < Date.parse(endsAt),
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

export function isSponsorCampaignActive(id: string, now = Date.now()) {
  return activeSponsorCampaigns(now).some((campaign) => campaign.id === id);
}

// The README has one ad and no rotation, so only exclusive campaigns use it.
export function activeReadmeSponsorCampaign<
  T extends SponsorCampaign = ScheduledSponsorCampaign,
>(now = Date.now(), campaigns?: readonly T[]) {
  return activeSponsorCampaigns<T>(now, campaigns).find(
    (campaign) => campaign.package === "exclusive",
  );
}

const SPONSOR_ROTATION_MS = 60 * 60 * 1000;

// What the layout renders: the live campaigns and this render's rotation.
export function renderedSponsorSchedule(now = Date.now()) {
  return {
    campaignIds: activeSponsorCampaigns(now).map(({ id }) => id),
    rotation: Math.floor(now / SPONSOR_ROTATION_MS),
  };
}

/**
 * The one ad a page view shows. With two shared campaigns each page takes one
 * per hour, from a hash of its path and the hour: the server-rendered HTML and
 * the browser pick the same ad (no swap after load), a page never flips while
 * open, and over a 30-day run each sponsor gets about half of every page.
 */
export function pickSponsorCampaign<T>(
  campaigns: readonly T[],
  pathname: string,
  bucket: number,
): T | undefined {
  if (campaigns.length < 2) return campaigns[0];
  // FNV-1a: tiny, stable and well spread for short strings.
  let hash = 0x811c9dc5;
  for (const char of `${pathname}:${bucket}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return campaigns[(hash >>> 0) % campaigns.length];
}

function nextSponsorTransition(now: number) {
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
export function lastBookedSponsorCampaign(
  now = Date.now(),
  campaigns: readonly BookedSponsorCampaign[] = scheduledSponsorCampaigns,
) {
  return [...campaigns]
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

/**
 * The answer of GET /api/sponsor: which campaigns show now. One function for
 * the route and for the Cloudflare Worker entry, which answers this call
 * itself (every page makes it; it needs nothing but the clock).
 * `previewCampaigns` is SPONSOR_PREVIEW_CAMPAIGN: on a host other than the
 * site, one campaign or a comma-separated rotation to show instead.
 */
export function sponsorAnswer(
  hostname: string,
  now: number,
  previewCampaigns = "",
) {
  const preview = !isProductionSponsorHost(hostname)
    ? previewCampaigns
        .split(",")
        .flatMap((id) => findSponsorCampaign(id.trim()) ?? [])
    : [];
  const campaigns = preview.length ? preview : activeSponsorCampaigns(now);
  return {
    campaignIds: campaigns.map(({ id }) => id),
    // Tabs still running the single-sponsor client read this field.
    campaignId: campaigns[0]?.id ?? null,
    serverTime: now,
    nextTransition: preview.length
      ? null
      : (nextSponsorTransition(now) ?? null),
    preview: preview.length > 0,
  };
}

export const SPONSOR_ANSWER_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
} as const;
