import "server-only";

import { isPriorityPlace } from "~/features/admin/priority-places";
import type { PriorityPlaces, VideoAudience } from "~/features/admin/types";

// Who may make new explainer videos during early access: anyone, on any
// device, in the places GitDiagram's most valuable audience lives. It mirrors
// the PostHog "priority audiences" (docs/operations/posthog.md). Everyone can
// still watch and download every video already made.
//
// Location is Vercel's IP geolocation and the device is the browser's own
// report, so this is an access rule, not a security boundary: VPNs and
// spoofed user agents get through. The daily budgets still bound spend.

// The places themselves live in one shared rule, which the /admin dashboard's
// "Priority places" count also uses.

const MOBILE =
  /Mobi|Android|iPhone|iPad|iPod|Windows Phone|webOS|BlackBerry|Opera Mini|IEMobile|Silk|Kindle/i;
const DESKTOP = /Macintosh|Mac OS X|Windows NT|X11|Linux x86_64|CrOS/i;

export function isDesktopRequest(request: Request): boolean {
  const headers = request.headers;
  if (headers.get("sec-ch-ua-mobile") === "?1") return false;
  const platform = headers.get("sec-ch-ua-platform")?.replace(/"/g, "");
  if (platform && /Android|iOS/i.test(platform)) return false;
  const agent = headers.get("user-agent") ?? "";
  return !MOBILE.test(agent) && DESKTOP.test(agent);
}

export function isInVideoRegion(
  request: Request,
  places: PriorityPlaces = "cities",
): boolean {
  const headers = request.headers;
  const lat = Number.parseFloat(headers.get("x-vercel-ip-latitude") ?? "");
  const lon = Number.parseFloat(headers.get("x-vercel-ip-longitude") ?? "");
  return isPriorityPlace(
    {
      country: headers.get("x-vercel-ip-country") ?? "",
      region: headers.get("x-vercel-ip-country-region") ?? "",
      city: safeDecode(headers.get("x-vercel-ip-city") ?? ""),
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
    },
    places,
  );
}

/** Vercel percent-encodes the city; off Vercel the header may be anything. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Whether this visitor may make new videos. The operator widens the audience
 * from /admin: the early-access places, plus any desktop, or everyone.
 */
export function canMakeVideosHere(
  request: Request,
  audience: VideoAudience = "priority",
  places: PriorityPlaces = "cities",
): boolean {
  return audienceBlock(request, audience, places) === null;
}

/**
 * Why the audience rule holds this visitor back: outside the early-access
 * places, or, once the operator opens it to all desktops, not on a desktop.
 * Null when it lets them in.
 */
export function audienceBlock(
  request: Request,
  audience: VideoAudience = "priority",
  places: PriorityPlaces = "cities",
): "mobile" | "place" | null {
  if (audience === "everyone" || isInVideoRegion(request, places)) return null;
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
  places: PriorityPlaces = "cities",
): boolean {
  return audience === "everyone" || isInVideoRegion(request, places);
}

const EARLY_ACCESS_MESSAGE =
  "Making new videos is in early access in a few places for now. Every video already made is free to watch.";

const DESKTOP_ONLY_MESSAGE =
  "Making new videos needs a computer here for now. Every video already made is free to watch.";

/** What to tell a visitor the audience rule holds back. */
export function audienceMessage(block: "mobile" | "place"): string {
  return block === "mobile" ? DESKTOP_ONLY_MESSAGE : EARLY_ACCESS_MESSAGE;
}
