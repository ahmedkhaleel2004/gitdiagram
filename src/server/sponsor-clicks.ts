import "server-only";

import { sentCampaign, type SponsorPlacement } from "~/lib/sponsor-campaign";

const automatedAgent =
  /bot|crawler|spider|slurp|preview|facebookexternalhit|facebot|whatsapp|telegram|discord|slack|curl|wget|python|httpclient|headless|lighthouse|pingdom|uptime|monitor/i;

export function shouldRecordSponsorClick(request: Request) {
  const { headers } = request;
  const agent = headers.get("user-agent") ?? "";
  const purpose = ["purpose", "sec-purpose", "x-purpose"]
    .map((name) => headers.get(name) ?? "")
    .join(" ");
  const mode = headers.get("sec-fetch-mode");

  return (
    request.method === "GET" &&
    ["gitdiagram.com", "www.gitdiagram.com"].includes(
      new URL(request.url).hostname,
    ) &&
    Boolean(agent) &&
    !automatedAgent.test(agent) &&
    !/prefetch|prerender/i.test(purpose) &&
    !headers.has("next-router-prefetch") &&
    !headers.has("x-middleware-prefetch") &&
    (!mode || mode === "navigate") &&
    headers.get("dnt") !== "1" &&
    headers.get("sec-gpc") !== "1"
  );
}

export function sponsorDestination(placement: SponsorPlacement) {
  const url = new URL(sentCampaign.destination);
  url.searchParams.set("utm_source", "gitdiagram");
  url.searchParams.set("utm_medium", "sponsorship");
  url.searchParams.set("utm_campaign", sentCampaign.utmCampaign);
  url.searchParams.set("utm_content", placement);
  return url;
}

export async function recordSponsorClick({
  placement,
  visitorId,
  isTest,
}: {
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
        uuid: crypto.randomUUID(),
        event: "sponsor_click",
        distinct_id: `sponsor:${visitorId}`,
        timestamp: new Date().toISOString(),
        properties: {
          campaign: sentCampaign.id,
          sponsor: sentCampaign.sponsor,
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
      console.warn("Sponsor click capture failed", { status: response.status });
    }
  } catch {
    // Click delivery must remain independent of analytics availability.
    console.warn("Sponsor click capture unavailable");
  }
}
