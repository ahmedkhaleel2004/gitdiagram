// Pure helpers for the Cloudflare Worker entry (cloudflare/worker.ts). They
// make a request on Cloudflare look to the app like one on Vercel, so the
// route code is the same on both.

/** What Cloudflare knows about the caller (`request.cf`). */
export interface CloudflareGeo {
  country?: unknown;
  regionCode?: unknown;
  city?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}

// Headers the platform owns. A caller's own copies are always dropped, so
// nobody can claim a place or an address.
const PLATFORM_HEADERS = [
  "x-vercel-ip-country",
  "x-vercel-ip-country-region",
  "x-vercel-ip-city",
  "x-vercel-ip-latitude",
  "x-vercel-ip-longitude",
  "x-vercel-ip-timezone",
  "x-vercel-ip-continent",
  "x-vercel-ip-postal-code",
  "x-vercel-forwarded-for",
  "x-vercel-deployment-url",
  "x-vercel-id",
  "x-forwarded-for",
  "x-real-ip",
];

const text = (value: unknown, pattern: RegExp): string =>
  typeof value === "string" && pattern.test(value) ? value : "";

/**
 * The request headers the app should see: the caller's, minus anything the
 * platform owns, plus Vercel-style geolocation and client-address headers
 * filled from Cloudflare's own knowledge of the connection.
 */
export function platformHeaders(
  incoming: Headers,
  cf: CloudflareGeo | undefined,
): Headers {
  const headers = new Headers(incoming);
  for (const name of PLATFORM_HEADERS) headers.delete(name);

  const ip = incoming.get("cf-connecting-ip")?.trim();
  if (ip) {
    headers.set("x-forwarded-for", ip);
    headers.set("x-real-ip", ip);
  }

  // "T1" (Tor) and "XX" (unknown) are not countries.
  const country = text(cf?.country, /^[A-Z]{2}$/);
  if (country && country !== "XX" && country !== "T1")
    headers.set("x-vercel-ip-country", country);
  const region = text(cf?.regionCode, /^[A-Z0-9]{1,3}$/);
  if (region) headers.set("x-vercel-ip-country-region", region);
  // Vercel percent-encodes the city.
  if (typeof cf?.city === "string" && cf.city && cf.city.length <= 100)
    headers.set("x-vercel-ip-city", encodeURIComponent(cf.city));
  const latitude = text(cf?.latitude, /^-?\d{1,3}(?:\.\d+)?$/);
  const longitude = text(cf?.longitude, /^-?\d{1,3}(?:\.\d+)?$/);
  if (latitude && longitude) {
    headers.set("x-vercel-ip-latitude", latitude);
    headers.set("x-vercel-ip-longitude", longitude);
  }
  return headers;
}

/**
 * Routes that run ffmpeg or Chromium, which a Worker cannot: the Worker hands
 * them to the render Container. `GET /api/video` and the other video routes
 * stay on the Worker.
 */
export function isContainerPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "");
  return (
    path === "/api/video/generate" ||
    path === "/api/video/render" ||
    path === "/api/video/render/segment"
  );
}

/** The internal route each cron schedule calls (same as vercel.json). */
export const CRON_ROUTES: Record<string, string> = {
  "*/5 * * * *": "/api/internal/browse-index/drain",
  "*/15 * * * *": "/api/internal/video-payments/sweep",
  "0 13 * * *": "/api/internal/ai-visibility",
};
