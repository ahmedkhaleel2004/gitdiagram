import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { upstashCommand } from "~/server/storage/upstash";

// The operator (the site's owner) signs in to /admin with the operator token,
// VIDEO_ADMIN_TOKEN. The browser then holds a signed session cookie, never the
// token itself.
//
// Signing out everywhere bumps a session generation number in Redis; every
// cookie carries (and is signed over) the generation it was issued in, so
// older cookies stop working. Rotating the token still signs every session
// out, and is the hard stop: while Redis cannot be read, a correctly signed,
// unexpired cookie is accepted (the last generation this instance read still
// applies), so the operator is never locked out of the dashboard by an outage.

const SESSION_DAYS = 30;
const GENERATION_KEY = "admin:v1:session-generation";
const GENERATION_CACHE_MS = 5_000;

export const ADMIN_SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-gd_admin" : "gd_admin";

function operatorToken(): string | null {
  const token = process.env.VIDEO_ADMIN_TOKEN?.trim();
  return token && token.length >= 32 ? token : null;
}

/** Whether VIDEO_ADMIN_TOKEN is set, and long enough to be used. */
export function isOperatorConfigured(): boolean {
  return operatorToken() !== null;
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

// The generation this instance read last (value null: Redis could not be
// read and nothing was known before), and when.
let generationCache: { at: number; value: number | null } | null = null;
let generationRead: Promise<number | null> | null = null;

async function readGeneration(): Promise<number | null> {
  const known = generationCache?.value ?? null;
  try {
    const raw = await upstashCommand<string | null>(["GET", GENERATION_KEY]);
    const value = Number(raw ?? 0);
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("Bad session generation.");
    generationCache = { at: Date.now(), value };
    return value;
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "admin.session_generation.unavailable",
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      }),
    );
    // Remember the failure briefly too, so an outage does not add a Redis
    // timeout to every admin request.
    generationCache = { at: Date.now(), value: known };
    return known;
  }
}

/** The current session generation, read at most every few seconds. */
async function sessionGeneration(now = Date.now()): Promise<number | null> {
  if (generationCache && now - generationCache.at < GENERATION_CACHE_MS)
    return generationCache.value;
  generationRead ??= readGeneration().finally(() => {
    generationRead = null;
  });
  return generationRead;
}

function sign(token: string, payload: string): string {
  return createHmac("sha256", token).update(payload).digest("base64url");
}

export async function createAdminSession(now = Date.now()): Promise<{
  value: string;
  maxAgeSeconds: number;
} | null> {
  const token = operatorToken();
  if (!token) return null;
  const generation = (await sessionGeneration(now)) ?? 0;
  const maxAgeSeconds = SESSION_DAYS * 86_400;
  const expires = now + maxAgeSeconds * 1000;
  const signature = sign(token, `admin-session:v2:${expires}:${generation}`);
  return {
    value: `v2.${expires}.${generation}.${signature}`,
    maxAgeSeconds,
  };
}

/**
 * The generation a correctly signed, unexpired session cookie was issued in,
 * or null for anything else. Cookies from before generations existed (v1)
 * count as generation 0, so they last until the first sign-out everywhere.
 */
function generationOf(
  value: string | undefined | null,
  now: number,
): number | null {
  const token = operatorToken();
  if (!token || !value) return null;
  const parts = value.split(".");
  const expires = Number(parts[1]);
  if (!Number.isSafeInteger(expires) || expires <= now) return null;
  if (parts[0] === "v1" && parts.length === 3)
    return sameText(parts[2]!, sign(token, `admin-session:v1:${expires}`))
      ? 0
      : null;
  if (parts[0] !== "v2" || parts.length !== 4) return null;
  const generation = Number(parts[2]);
  if (!/^\d{1,15}$/.test(parts[2]!) || !Number.isSafeInteger(generation))
    return null;
  return sameText(
    parts[3]!,
    sign(token, `admin-session:v2:${expires}:${generation}`),
  )
    ? generation
    : null;
}

/**
 * Whether a session cookie is valid against `generation`, the current
 * session generation. Null means unknown (Redis unreadable), which accepts
 * any correctly signed, unexpired cookie.
 */
export function isAdminSession(
  value: string | undefined | null,
  now = Date.now(),
  generation: number | null = generationCache?.value ?? null,
): boolean {
  const own = generationOf(value, now);
  return own !== null && (generation === null || own === generation);
}

/** Checks a session cookie against the current generation in Redis. */
export async function verifyAdminSession(
  value: string | undefined | null,
  now = Date.now(),
): Promise<boolean> {
  if (generationOf(value, now) === null) return false;
  return isAdminSession(value, now, await sessionGeneration(now));
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** Whether the request carries a valid dashboard session (checked in Redis). */
export function verifyAdminRequest(request: Request): Promise<boolean> {
  return verifyAdminSession(readCookie(request, ADMIN_SESSION_COOKIE));
}

/** Signs every browser out of /admin. Throws when Redis is unavailable. */
export async function revokeAdminSessions(): Promise<number> {
  const value = Number(await upstashCommand<number>(["INCR", GENERATION_KEY]));
  generationCache = { at: Date.now(), value };
  return value;
}

export function resetOperatorSessionsForTests(): void {
  generationCache = null;
  generationRead = null;
}
