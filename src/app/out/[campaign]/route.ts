import { after, NextRequest, NextResponse } from "next/server";
import {
  findSponsorCampaign,
  sponsorPlacements,
  type SponsorPlacement,
} from "~/lib/sponsor-campaign";
import {
  recordSponsorEvent,
  shouldRecordSponsorClick,
  sponsorDestination,
  sponsorVisitor,
} from "~/server/sponsor-clicks";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

type Context = { params: Promise<{ campaign: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { campaign } = await context.params;
  const config = findSponsorCampaign(campaign);
  const placement = request.nextUrl.searchParams.get("placement");
  if (!config || !sponsorPlacements.includes(placement as SponsorPlacement)) {
    return new NextResponse("Unknown sponsor placement", {
      status: 404,
      headers,
    });
  }

  const surface = placement as SponsorPlacement;
  // The destination is allowlisted in code; never accept a redirect URL from input.
  const response = NextResponse.redirect(sponsorDestination(surface, config), {
    status: 302,
    headers,
  });

  if (
    shouldRecordSponsorClick(request) &&
    process.env.NEXT_PUBLIC_POSTHOG_KEY
  ) {
    const visitorId = sponsorVisitor(request, response);
    const isTest = request.nextUrl.searchParams.get("test") === "1";
    after(() =>
      recordSponsorEvent({
        event: "sponsor_click",
        campaign: config,
        placement: surface,
        visitorId,
        isTest,
      }),
    );
  }

  return response;
}

// Next's automatic HEAD handler invokes GET. Explicitly suppress click capture.
export async function HEAD(request: NextRequest, context: Context) {
  return GET(
    new NextRequest(request.url, { method: "HEAD", headers: request.headers }),
    context,
  );
}
