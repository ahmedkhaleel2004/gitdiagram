import "server-only";

import { readCookie } from "~/server/http/cookies";
import { isOperatorSignature, operatorSignature } from "./operator";

// "See video pages as a visitor from …" in /admin: the operator's browser is
// placed in another country, so they can see (and use) the site exactly as a
// visitor there does, without a VPN. While it is on, that browser is not a
// video admin: it gets that country's rules, limits and paid offer.
//
// The country lives in a cookie signed with the operator token, so only a
// browser that was signed in to /admin can have one, and it lasts 12 hours.

const VIEW_AS_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-gd_view_as" : "gd_view_as";

const HOURS = 12;
const COUNTRY = /^[A-Z]{2}$/;

const payload = (country: string, expires: number) =>
  `view-as:v1:${country}:${expires}`;

/** The cookie that places this browser in `country`, or null without a token. */
export function viewAsCookie(country: string, now = Date.now()): string | null {
  if (!COUNTRY.test(country)) return null;
  const expires = now + HOURS * 3_600_000;
  const signature = operatorSignature(payload(country, expires));
  if (!signature) return null;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${VIEW_AS_COOKIE}=${country}.${expires}.${signature}; Path=/; Max-Age=${HOURS * 3600}; HttpOnly; SameSite=Lax${secure}`;
}

/** The cookie that ends it. */
export function clearViewAsCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${VIEW_AS_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

/** The country the operator placed this browser in, if a valid cookie says so. */
export function viewAsCountry(
  request: Request,
  now = Date.now(),
): string | null {
  const value = readCookie(request, VIEW_AS_COOKIE);
  if (!value) return null;
  const [country, expiresText, signature] = value.split(".");
  const expires = Number(expiresText);
  if (
    !country ||
    !signature ||
    !COUNTRY.test(country) ||
    !Number.isSafeInteger(expires) ||
    expires <= now
  )
    return null;
  return isOperatorSignature(payload(country, expires), signature)
    ? country
    : null;
}
