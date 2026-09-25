import { after, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  activeSponsorCampaign,
  findSponsorCampaign,
  websiteSponsorPlacements,
} from "~/lib/sponsor-campaign";
import { getClientIp } from "~/server/http/client-ip";
import { parseSameOriginJsonRequest } from "~/server/http/same-origin-json";
import {
  claimSponsorEvent,
  recordSponsorEvent,
  shouldRecordSponsorEvent,
  sponsorVisitor,
} from "~/server/sponsor-clicks";

export const dynamic = "force-dynamic";
const placement = z.enum(websiteSponsorPlacements);
const schema = z.union([
  z.strictObject({ placement, pageViewId: z.uuid() }),
  // Tabs loaded before page-view IDs send a random ID per request instead.
  z
    .strictObject({ placement, eventId: z.uuid() })
    .transform(({ eventId, ...event }) => ({ ...event, pageViewId: eventId })),
]);

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ campaign: string }> },
) {
  const { campaign: id } = await context.params;
  const campaign = findSponsorCampaign(id);
  if (!campaign) return new Response(null, { status: 404 });
  const parsed = await parseSameOriginJsonRequest(request, {
    schema,
    maxBytes: 512,
    crossOriginError: "Cross-origin capture is not allowed.",
  });
  if (!parsed.success) return parsed.response;
  const response = new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
  const isTest = request.nextUrl.searchParams.get("test") === "1";
  if (
    !shouldRecordSponsorEvent(request) ||
    !process.env.NEXT_PUBLIC_POSTHOG_KEY ||
    (!isTest && activeSponsorCampaign()?.id !== campaign.id)
  )
    return response;
  const visitorId = sponsorVisitor(request, response);
  const clientIp = getClientIp(request);
  const { placement, pageViewId } = parsed.data;
  after(async () => {
    // Verification events are excluded from reports, so they skip dedupe.
    if (
      isTest ||
      (await claimSponsorEvent({
        event: "sponsor_impression",
        campaignId: campaign.id,
        placement,
        clientIp,
        pageViewId,
      }))
    )
      await recordSponsorEvent({
        event: "sponsor_impression",
        campaign,
        placement,
        visitorId,
        isTest,
      });
  });
  return response;
}
