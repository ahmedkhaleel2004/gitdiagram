import "server-only";

import type { VideoAudience } from "~/features/admin/types";

// Who may make new explainer videos during early access: anyone, on any
// device, in the places GitDiagram's most valuable audience lives. It mirrors
// the PostHog "priority audiences" (docs/operations/posthog.md). Everyone can
// still watch and download every video already made.
//
// Location is Vercel's IP geolocation and the device is the browser's own
// report, so this is an access rule, not a security boundary: VPNs and
// spoofed user agents get through. The daily budgets still bound spend.

const REGIONS: Record<string, string[]> = {
  US: ["CA", "WA", "NY"],
  CA: ["ON", "BC"],
};

// "Anywhere around London": within 60 km of central London.
const LONDON = { lat: 51.5072, lon: -0.1276, km: 60 };

const MOBILE =
  /Mobi|Android|iPhone|iPad|iPod|Windows Phone|webOS|BlackBerry|Opera Mini|IEMobile|Silk|Kindle/i;
const DESKTOP = /Macintosh|Mac OS X|Windows NT|X11|Linux x86_64|CrOS/i;

function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function isDesktopRequest(request: Request): boolean {
  const headers = request.headers;
  if (headers.get("sec-ch-ua-mobile") === "?1") return false;
  const platform = headers.get("sec-ch-ua-platform")?.replace(/"/g, "");
  if (platform && /Android|iOS/i.test(platform)) return false;
  const agent = headers.get("user-agent") ?? "";
  return !MOBILE.test(agent) && DESKTOP.test(agent);
}

export function isInVideoRegion(request: Request): boolean {
  const headers = request.headers;
  const country = headers.get("x-vercel-ip-country") ?? "";
  const region = headers.get("x-vercel-ip-country-region") ?? "";
  if (REGIONS[country]?.includes(region)) return true;
  if (country !== "GB") return false;
  const lat = Number.parseFloat(headers.get("x-vercel-ip-latitude") ?? "");
  const lon = Number.parseFloat(headers.get("x-vercel-ip-longitude") ?? "");
  if (Number.isFinite(lat) && Number.isFinite(lon))
    return distanceKm({ lat, lon }, LONDON) <= LONDON.km;
  const city = decodeURIComponent(headers.get("x-vercel-ip-city") ?? "");
  return /london/i.test(city);
}

/**
 * Whether this visitor may make new videos. The operator widens the audience
 * from /admin: the early-access places, plus any desktop, or everyone.
 */
export function canMakeVideosHere(
  request: Request,
  audience: VideoAudience = "priority",
): boolean {
  return audienceBlock(request, audience) === null;
}

/**
 * Why the audience rule holds this visitor back: outside the early-access
 * places, or, once the operator opens it to all desktops, not on a desktop.
 * Null when it lets them in.
 */
export function audienceBlock(
  request: Request,
  audience: VideoAudience = "priority",
): "mobile" | "place" | null {
  if (audience === "everyone" || isInVideoRegion(request)) return null;
  if (audience !== "desktop") return "place";
  return isDesktopRequest(request) ? null : "mobile";
}

/**
 * Whether this visitor may make videos from any device, tablets included.
 * Only visitors let in as "any desktop" need to be on one.
 */
export function anyDeviceHere(
  request: Request,
  audience: VideoAudience = "priority",
): boolean {
  return audience === "everyone" || isInVideoRegion(request);
}

const EARLY_ACCESS_MESSAGE =
  "Making new videos is in early access in a few places for now. Every video already made is free to watch.";

const DESKTOP_ONLY_MESSAGE =
  "Making new videos needs a computer here for now. Every video already made is free to watch.";

/** What to tell a visitor the audience rule holds back. */
export function audienceMessage(block: "mobile" | "place"): string {
  return block === "mobile" ? DESKTOP_ONLY_MESSAGE : EARLY_ACCESS_MESSAGE;
}
