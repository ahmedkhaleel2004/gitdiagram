import "server-only";

import { createHash } from "node:crypto";
import {
  isProductionSponsorHost,
  type SponsorCampaign,
  type SponsorPlacement,
} from "~/lib/sponsor-campaign";
import { type NextRequest, type NextResponse } from "next/server";
import { toRateLimitBucket } from "~/server/generate/rate-limit";
import { upstashEval } from "~/server/storage/upstash";

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

// One click per network, campaign and placement in each window, so repeat
// clicks, reloads of the redirect and simple scripts count once.
const CLICK_WINDOW_SECONDS = 30 * 60;
// Impressions: one per page view (the browser's page-view ID), and at most this
// many per network and campaign each hour across placements. A person browsing
// quickly stays well under it; a script replaying requests does not.
const IMPRESSIONS_PER_NETWORK_HOUR = 120;
const PAGE_VIEW_TTL_SECONDS = 24 * 60 * 60;

// KEYS[1] must be new (SET NX); KEYS[2], when given, is a capped counter.
const CLAIM_SCRIPT = `
if not redis.call("SET", KEYS[1], "1", "NX", "EX", ARGV[1]) then
  return 0
end
if KEYS[2] then
  local count = redis.call("INCR", KEYS[2])
  if count == 1 then
    redis.call("EXPIRE", KEYS[2], ARGV[3])
  end
  if count > tonumber(ARGV[2]) then
    return 0
  end
end
return 1
`;

// Keys hold a hash of the network (IPv6 collapsed to its /64), never the IP.
function networkKey(clientIp: string) {
  return createHash("sha256")
    .update(`gitdiagram-sponsor:${toRateLimitBucket(clientIp)}`)
    .digest("hex")
    .slice(0, 32);
}

type SponsorEventClaim = {
  campaignId: string;
  placement: SponsorPlacement;
  clientIp: string | null;
} & (
  | { event: "sponsor_click" }
  | { event: "sponsor_impression"; pageViewId: string }
);

/**
 * Server-side dedupe on top of the header-based bot and opt-out checks, which
 * any script can pass. Resolves false for a duplicate. Fails open (true) when
 * Redis is unavailable, and click dedupe needs a caller IP. Callers run it in
 * `after()`, so it never delays or blocks the redirect or the 204.
 */
export async function claimSponsorEvent(
  claim: SponsorEventClaim,
  now = Date.now(),
): Promise<boolean> {
  const { campaignId, placement, clientIp } = claim;
  const network = clientIp ? networkKey(clientIp) : null;
  const seconds = Math.floor(now / 1000);
  let keys: string[];
  let args: number[];
  if (claim.event === "sponsor_click") {
    if (!network) return true;
    const window = seconds - (seconds % CLICK_WINDOW_SECONDS);
    keys = [`sponsor:v1:click:${campaignId}:${placement}:${network}:${window}`];
    args = [window + CLICK_WINDOW_SECONDS - seconds];
  } else {
    const hour = seconds - (seconds % 3600);
    keys = [
      `sponsor:v1:impression:${campaignId}:${placement}:${claim.pageViewId}`,
      ...(network
        ? [`sponsor:v1:impression-cap:${campaignId}:${network}:${hour}`]
        : []),
    ];
    args = [
      PAGE_VIEW_TTL_SECONDS,
      IMPRESSIONS_PER_NETWORK_HOUR,
      hour + 3600 - seconds,
    ];
  }
  try {
    const claimed = await upstashEval<number>({
      script: CLAIM_SCRIPT,
      keys,
      args,
    });
    return claimed === 1;
  } catch {
    console.warn(
      JSON.stringify({
        event: "sponsor.dedupe.unavailable",
        error: "Sponsor dedupe failed; recording the event.",
      }),
    );
    return true;
  }
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
