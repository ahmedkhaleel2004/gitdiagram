import {
  activeSponsorCampaigns,
  findSponsorCampaign,
  isProductionSponsorHost,
  nextSponsorTransition,
} from "~/lib/sponsor-campaign";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const now = Date.now();
  // Preview deployments may show one campaign, or a comma-separated rotation.
  const preview = !isProductionSponsorHost(new URL(request.url).hostname)
    ? (process.env.SPONSOR_PREVIEW_CAMPAIGN ?? "")
        .split(",")
        .flatMap((id) => findSponsorCampaign(id.trim()) ?? [])
    : [];
  const campaigns = preview.length ? preview : activeSponsorCampaigns(now);
  return Response.json(
    {
      campaignIds: campaigns.map(({ id }) => id),
      // Tabs still running the single-sponsor client read this field.
      campaignId: campaigns[0]?.id ?? null,
      serverTime: now,
      nextTransition: preview.length
        ? null
        : (nextSponsorTransition(now) ?? null),
      preview: preview.length > 0,
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    },
  );
}
