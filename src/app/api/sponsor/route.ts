import {
  activeSponsorCampaign,
  findSponsorCampaign,
  isProductionSponsorHost,
  nextSponsorTransition,
} from "~/lib/sponsor-campaign";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const now = Date.now();
  const preview = !isProductionSponsorHost(new URL(request.url).hostname)
    ? findSponsorCampaign(process.env.SPONSOR_PREVIEW_CAMPAIGN ?? "")
    : undefined;
  const campaign = preview ?? activeSponsorCampaign(now);
  return Response.json(
    {
      campaignId: campaign?.id ?? null,
      serverTime: now,
      nextTransition: preview ? null : (nextSponsorTransition(now) ?? null),
      preview: Boolean(preview),
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    },
  );
}
