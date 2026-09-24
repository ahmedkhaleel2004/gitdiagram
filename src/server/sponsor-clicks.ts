import "server-only";

import {
  isProductionSponsorHost,
  type SponsorCampaign,
  type SponsorPlacement,
} from "~/lib/sponsor-campaign";
import { type NextRequest, type NextResponse } from "next/server";

const automatedAgent =
  /bot|crawler|spider|slurp|preview|facebookexternalhit|facebot|whatsapp|telegram|discord|slack|curl|wget|python|httpclient|headless|lighthouse|pingdom|uptime|monitor/i;

export function shouldRecordSponsorEvent(request: Request) {
  const { headers } = request;
  const agent = headers.get("user-agent") ?? "";
  const purpose = ["purpose", "sec-purpose", "x-purpose"]
    .map((name) => headers.get(name) ?? "")
    .join(" ");
  return (
    isProductionSponsorHost(new URL(request.url).hostname) &&
    Boolean(agent) &&
    !automatedAgent.test(agent) &&
    !/prefetch|prerender/i.test(purpose) &&
    !headers.has("next-router-prefetch") &&
    !headers.has("x-middleware-prefetch") &&
    headers.get("dnt") !== "1" &&
    headers.get("sec-gpc") !== "1"
  );
}

export function shouldRecordSponsorClick(request: Request) {
  const mode = request.headers.get("sec-fetch-mode");
  return (
    request.method === "GET" &&
    (!mode || mode === "navigate") &&
    shouldRecordSponsorEvent(request)
  );
}

export function sponsorDestination(
  placement: SponsorPlacement,
  campaign: SponsorCampaign,
) {
  const url = new URL(campaign.destination);
  // Sponsor-supplied attribution, if configured, takes precedence over defaults.
  for (const [key, value] of Object.entries({
    utm_source: "gitdiagram",
    utm_medium: "sponsorship",
    utm_campaign: campaign.utmCampaign,
    utm_content: placement,
  }))
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  return url;
}

const visitorCookie = "gd_sponsor_visitor";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sponsorVisitor(request: NextRequest, response: NextResponse) {
  const existing = request.cookies.get(visitorCookie)?.value;
  const visitorId =
    existing && uuidPattern.test(existing) ? existing : crypto.randomUUID();
  if (visitorId !== existing)
    response.cookies.set(visitorCookie, visitorId, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/out",
      maxAge: 60 * 60 * 24 * 30,
    });
  return visitorId;
}

export async function recordSponsorEvent({
  event,
  eventId = crypto.randomUUID(),
  campaign,
  placement,
  visitorId,
  isTest,
}: {
  event: "sponsor_click" | "sponsor_impression";
  eventId?: string;
  campaign: SponsorCampaign;
  placement: SponsorPlacement;
  visitorId: string;
  isTest: boolean;
}) {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
  if (!apiKey) return;

  try {
    const response = await fetch("https://us.i.posthog.com/i/v0/e/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        uuid: eventId,
        event,
        distinct_id: `sponsor:${visitorId}`,
        timestamp: new Date().toISOString(),
        properties: {
          campaign: campaign.id,
          sponsor: campaign.sponsor,
          placement,
          is_test: isTest,
          $process_person_profile: false,
          $geoip_disable: true,
          // Do not forward visitor IPs or infer a location from our server's IP.
          $ip: null,
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      console.warn("Sponsor event capture failed", { status: response.status });
    }
  } catch {
    // Click delivery must remain independent of analytics availability.
    console.warn("Sponsor event capture unavailable");
  }
}
