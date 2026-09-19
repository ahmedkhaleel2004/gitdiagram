import { after, NextRequest, NextResponse } from "next/server";
import {
  sentCampaign,
  sponsorPlacements,
  type SponsorPlacement,
} from "~/lib/sponsor-campaign";
import {
  recordSponsorClick,
  shouldRecordSponsorClick,
  sponsorDestination,
} from "~/server/sponsor-clicks";

export const dynamic = "force-dynamic";

const visitorCookie = "gd_sponsor_visitor";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

type Context = { params: Promise<{ campaign: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { campaign } = await context.params;
  const placement = request.nextUrl.searchParams.get("placement");
  if (
    campaign !== sentCampaign.id ||
    !sponsorPlacements.includes(placement as SponsorPlacement)
  ) {
    return new NextResponse("Unknown sponsor placement", {
      status: 404,
      headers,
    });
  }

  const surface = placement as SponsorPlacement;
  // The destination is allowlisted in code; never accept a redirect URL from input.
  const response = NextResponse.redirect(sponsorDestination(surface), {
    status: 302,
    headers,
  });

  if (
    shouldRecordSponsorClick(request) &&
    process.env.NEXT_PUBLIC_POSTHOG_KEY
  ) {
    const existing = request.cookies.get(visitorCookie)?.value;
    const visitorId =
      existing && uuidPattern.test(existing) ? existing : crypto.randomUUID();
    if (visitorId !== existing) {
      response.cookies.set(visitorCookie, visitorId, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/out",
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    const isTest = request.nextUrl.searchParams.get("test") === "1";
    after(() => recordSponsorClick({ placement: surface, visitorId, isTest }));
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
