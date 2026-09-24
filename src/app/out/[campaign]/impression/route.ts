import { after, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  activeSponsorCampaign,
  findSponsorCampaign,
} from "~/lib/sponsor-campaign";
import { parseSameOriginJsonRequest } from "~/server/http/same-origin-json";
import {
  recordSponsorEvent,
  shouldRecordSponsorEvent,
  sponsorVisitor,
} from "~/server/sponsor-clicks";

export const dynamic = "force-dynamic";
const schema = z.strictObject({
  placement: z.enum(["home", "diagram", "browse"]),
  eventId: z.uuid(),
});

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
  after(() =>
    recordSponsorEvent({
      event: "sponsor_impression",
      campaign,
      visitorId,
      isTest,
      ...parsed.data,
    }),
  );
  return response;
}
