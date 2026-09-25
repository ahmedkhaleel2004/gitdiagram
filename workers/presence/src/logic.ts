// The presence worker's pure parts: no Durable Object, no Cloudflare-only
// APIs (logic.test.ts; the object itself is tested in index.test.ts).

import type {
  LiveVisitor,
  PresenceMessage,
} from "../../../src/features/admin/types";
import {
  DASHBOARD_TOKEN_PREFIX,
  MAX_DASHBOARD_TOKEN_MS,
  MAX_JOB_ID,
  tokenExpiry,
} from "../../../src/features/admin/presence-protocol";

// Tabs ping every 30 s (throttled to about once a minute in the background).
// A socket silent for longer than this lost its network without closing.
export const STALE_MS = 150_000;
// Dashboards ping every 5 s, but a background dashboard's timers can slow to
// once a minute, so allow a little more than that.
export const ADMIN_STALE_MS = 90_000;
// A tab sends a message when it changes page or goes in or out of view. More
// changes (or messages the worker does not understand) than this in a minute
// is a script, not a person; the socket is closed. Messages that change
// nothing are not held against a person, but every message wakes the object,
// so there is a looser cap on all of them too.
export const MESSAGE_WINDOW_MS = 60_000;
export const MAX_MESSAGES_PER_WINDOW = 30;
export const MAX_FRAMES_PER_WINDOW = 120;

export const clip = (value: string | null | undefined, max: number) =>
  (value ?? "").slice(0, max);

/**
 * The referring site's host. Tabs send the referrer's origin (older ones sent
 * the whole address); a bare host is taken as it is.
 */
export function hostOf(value: string | null): string {
  if (!value) return "";
  // Checked first: "host:8443" also reads as an address with scheme "host:".
  if (/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(value))
    return value.toLowerCase().slice(0, 100);
  try {
    return new URL(value).host.slice(0, 100);
  } catch {
    return "";
  }
}

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * A coordinate from Cloudflare's geolocation ("51.50720"), or null. Kept to
 * one decimal (about 11 km), enough for the dashboard's 60 km priority areas
 * and no closer to where someone is than that needs.
 */
export function coordinate(value: string | null, limit: number): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit
    ? Math.round(parsed * 10) / 10
    : null;
}

/**
 * Counts one message against a socket's per-minute allowance: every message
 * against the frame cap (`mf`), and ones that changed something or were not
 * understood (`counted`) against the message cap (`mc`). The window and counts
 * live in the socket's attachment (`mw`), so they survive the object
 * hibernating between messages.
 */
export function countMessage(
  state: { mw?: number; mc?: number; mf?: number },
  now: number,
  counted = true,
): { mw: number; mc: number; mf: number; allowed: boolean } {
  const fresh = state.mw === undefined || now - state.mw >= MESSAGE_WINDOW_MS;
  const mw = fresh ? now : state.mw!;
  const mc = (fresh ? 0 : (state.mc ?? 0)) + (counted ? 1 : 0);
  const mf = (fresh ? 0 : (state.mf ?? 0)) + 1;
  return {
    mw,
    mc,
    mf,
    allowed: mc <= MAX_MESSAGES_PER_WINDOW && mf <= MAX_FRAMES_PER_WINDOW,
  };
}

/**
 * Whether a socket is still really there: it connected recently, or the
 * runtime answered one of its pings recently. A laptop that went to sleep or
 * lost its network keeps a socket open on our side that never pings again.
 */
export function isFresh(
  connectedAt: number,
  lastPing: number | null,
  now: number,
  staleMs: number,
): boolean {
  return (
    now - connectedAt < staleMs ||
    (lastPing !== null && now - lastPing <= staleMs)
  );
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** The key a job is stored under: the id itself, or a hash of a long one. */
export async function jobKey(id: string): Promise<string> {
  if (id.length <= MAX_JOB_ID) return id;
  return `sha256:${(await sha256Hex(id)).slice(0, 40)}`;
}

export interface Peak {
  day: string;
  count: number;
  at: number;
}

/**
 * Today's peak after seeing `count` people here. A new UTC day starts from
 * the people here right now, not from 0 and not from yesterday's number.
 */
export function rollPeak(
  stored: Peak | null,
  today: string,
  count: number,
  now: number,
): { peak: Peak; changed: boolean } {
  if (!stored || stored.day !== today || count > stored.count)
    return { peak: { day: today, count, at: now }, changed: true };
  return { peak: stored, changed: false };
}

type Update = Extract<PresenceMessage, { type: "update" }>;

/**
 * Changes waiting to go to open dashboards, sent together a moment later. A
 * tab that changes several times in that moment becomes one update, and only
 * the latest job list and peak are sent, so a busy (or hostile) visitor costs
 * the dashboards one message, not one per change. The kinds of messages are
 * the same as unbatched, so dashboards of any version understand them.
 */
export class Outbox {
  private queue: PresenceMessage[] = [];
  /** Where a visitor's next update merges: its queued join or update. */
  private pending = new Map<string, Update | LiveVisitor>();
  /** Visitors whose join is still queued. */
  private joined = new Set<string>();

  get size(): number {
    return this.queue.length;
  }

  push(message: PresenceMessage): void {
    switch (message.type) {
      case "join": {
        const visitor = { ...message.visitor };
        this.queue.push({ type: "join", visitor });
        this.pending.set(visitor.id, visitor);
        this.joined.add(visitor.id);
        return;
      }
      case "update": {
        const target = this.pending.get(message.id);
        const { type: _, id: __, ...fields } = message;
        if (target) {
          Object.assign(target, definedOnly(fields));
          return;
        }
        const update: Update = { ...message };
        this.queue.push(update);
        this.pending.set(message.id, update);
        return;
      }
      case "leave": {
        this.pending.delete(message.id);
        // Came and went within the moment: the dashboard never needs to know.
        if (this.joined.delete(message.id)) {
          this.queue = this.queue.filter(
            (queued) =>
              !(queued.type === "join" && queued.visitor.id === message.id),
          );
          return;
        }
        this.queue.push(message);
        return;
      }
      case "jobs":
      case "peak":
        this.queue = this.queue.filter(
          (queued) => queued.type !== message.type,
        );
        this.queue.push(message);
        return;
      default:
        this.queue.push(message);
    }
  }

  drain(): PresenceMessage[] {
    const messages = this.queue;
    this.queue = [];
    this.pending.clear();
    this.joined.clear();
    return messages;
  }
}

function definedOnly<T extends object>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time comparison of two strings. */
export function sameText(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index++)
    difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

/**
 * When a dashboard token expires, if it is genuine and current; else null.
 * The site mints them for ten minutes, so anything claiming to last longer
 * than fifteen is refused.
 */
export async function adminTokenExpiry(
  token: string,
  secret: string,
  now: number,
): Promise<number | null> {
  if (secret.length < 32) return null;
  const expires = tokenExpiry(token);
  if (expires === null) return null;
  if (expires <= now || expires > now + MAX_DASHBOARD_TOKEN_MS) return null;
  const [expiry = "", signature = ""] = token.split(".");
  return sameText(
    signature,
    await hmacHex(secret, `${DASHBOARD_TOKEN_PREFIX}${expiry}`),
  )
    ? expires
    : null;
}
