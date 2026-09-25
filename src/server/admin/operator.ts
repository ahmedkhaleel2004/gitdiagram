import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

// The operator (the site's owner) signs in to /admin with the operator token,
// VIDEO_ADMIN_TOKEN. The browser then holds a signed session cookie, never the
// token itself. Rotating the token signs every session out.

const SESSION_DAYS = 30;

export const ADMIN_SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-gd_admin" : "gd_admin";

function operatorToken(): string | null {
  const token = process.env.VIDEO_ADMIN_TOKEN?.trim();
  return token && token.length >= 32 ? token : null;
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isOperatorToken(presented: string): boolean {
  const token = operatorToken();
  return Boolean(token) && sameText(presented.trim(), token!);
}

function sign(token: string, expires: number): string {
  return createHmac("sha256", token)
    .update(`admin-session:v1:${expires}`)
    .digest("base64url");
}

export function createAdminSession(now = Date.now()): {
  value: string;
  maxAgeSeconds: number;
} | null {
  const token = operatorToken();
  if (!token) return null;
  const maxAgeSeconds = SESSION_DAYS * 86_400;
  const expires = now + maxAgeSeconds * 1000;
  return { value: `v1.${expires}.${sign(token, expires)}`, maxAgeSeconds };
}

export function isAdminSession(
  value: string | undefined | null,
  now = Date.now(),
): boolean {
  const token = operatorToken();
  if (!token || !value) return false;
  const [version, expiry, signature] = value.split(".");
  const expires = Number(expiry);
  if (version !== "v1" || !signature || !Number.isSafeInteger(expires))
    return false;
  if (expires <= now) return false;
  return sameText(signature, sign(token, expires));
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** Whether the request carries the operator's dashboard session. */
export function isAdminRequest(request: Request): boolean {
  return isAdminSession(readCookie(request, ADMIN_SESSION_COOKIE));
}
