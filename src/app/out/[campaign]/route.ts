import { after, NextRequest, NextResponse } from "next/server";
import {
  activeSponsorCampaign,
  findSponsorCampaign,
  isProductionSponsorHost,
  sponsorPlacements,
  type SponsorPlacement,
} from "~/lib/sponsor-campaign";
import { getClientIp } from "~/server/http/client-ip";
import {
  claimSponsorEvent,
  isSponsorTestRequest,
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

  const isTest = await isSponsorTestRequest(request);
  // Old README revisions and stale cached pages still link to campaigns that
  // have ended or not started. Those clicks go to /advertise and are not
  // recorded: an unpaid sponsor gets no traffic and the paying one no
  // misattributed clicks. Previews and the operator's `?test=1` checks keep
  // the real target.
  if (
    activeSponsorCampaign()?.id !== config.id &&
    !isTest &&
    isProductionSponsorHost(request.nextUrl.hostname)
  ) {
    return NextResponse.redirect(new URL("/advertise", request.url), {
      status: 302,
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
    const clientIp = getClientIp(request);
    after(async () => {
      // Verification clicks are excluded from reports, so they skip dedupe.
      if (
        isTest ||
        (await claimSponsorEvent({
          event: "sponsor_click",
          campaignId: config.id,
          placement: surface,
          clientIp,
        }))
      )
        await recordSponsorEvent({
          event: "sponsor_click",
          campaign: config,
          placement: surface,
          visitorId,
          isTest,
        });
    });
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
