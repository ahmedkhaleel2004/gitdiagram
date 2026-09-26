import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";

import {
  DASHBOARD_TOKEN_MS,
  DASHBOARD_TOKEN_PREFIX,
  FEED_EVENTS,
  FEED_WATCH_MS,
  MAX_JOB_ID,
  MAX_PARKED_EVENT_AGE_MS,
  SIGNED_OUT_EVERYWHERE,
} from "~/features/admin/presence-protocol";
import { isDesktopRequest } from "~/server/explainer/audience";
import { requestGeo } from "~/server/http/vercel-geo";
import { logEvent } from "~/server/log";
import { upstashEval } from "~/server/storage/upstash";

// Sends what the site is doing (generations starting and finishing, visitors
// held back by the video gate, switches flipped) to the presence worker
// (workers/presence), which pushes each event to the operator's open dashboard
// the moment it arrives. Sending is best effort and never slows or fails the
// request it describes.
//
// While no dashboard is open, events wait in Redis instead (the worker runs on
// Cloudflare's free daily requests, and each event sent is two). The worker
// takes them when a dashboard connects, and every minute while one is open,
// through /api/admin/presence-feed, which also marks the feed watched for
// FEED_WATCH_MS so events meanwhile go straight to it. If Redis cannot be
// reached, events are sent straight away as before.

const WATCHING_KEY = "admin:v1:feed:watching";
const PARKED_KEY = "admin:v1:feed:parked";

// Returns 1 while a dashboard is watching; otherwise parks the event (keeping
// the newest FEED_EVENTS, as the feed does) and returns 0.
const PARK_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 1 end
redis.call('RPUSH', KEYS[2], ARGV[1])
redis.call('LTRIM', KEYS[2], -tonumber(ARGV[2]), -1)
redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[3]))
return 0
`;

// Marks the feed watched, and hands over (and forgets) what was parked.
const DRAIN_SCRIPT = `
redis.call('SET', KEYS[1], '1', 'PX', tonumber(ARGV[1]))
local parked = redis.call('LRANGE', KEYS[2], 0, -1)
redis.call('DEL', KEYS[2])
return parked
`;

const SEND_TIMEOUT_MS = 2_000;

export interface LiveEvent {
  kind: string;
  repo?: string;
  /** Marks a long-running job so the dashboard can list what is running now. */
  job?: { id: string; state: "start" | "end"; label?: string };
  [detail: string]: unknown;
}

/** The worker's WebSocket origin, e.g. wss://gitdiagram-presence.example.workers.dev. */
export function presenceSocketUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_PRESENCE_URL?.trim().replace(/\/$/, "");
  return url && /^wss?:\/\//.test(url) ? url : null;
}

function presenceSecret(): string | null {
  const secret = process.env.PRESENCE_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

/**
 * A short-lived token (minutes) that lets the dashboard open the worker's
 * admin socket.
 * Only a signed-in dashboard gets one (each poll of its state checks the
 * session against Redis), so a browser signed out, or out everywhere, loses
 * its socket within DASHBOARD_TOKEN_MS: the worker closes a dashboard whose
 * token runs out without a newer one.
 */
export function createPresenceToken(now = Date.now()): string | null {
  const secret = presenceSecret();
  if (!secret) return null;
  const expires = now + DASHBOARD_TOKEN_MS;
  const signature = createHmac("sha256", secret)
    .update(`${DASHBOARD_TOKEN_PREFIX}${expires}`)
    .digest("hex");
  return `${expires}.${signature}`;
}

/**
 * The id a job is known by in the feed: short ids as they are, longer ones
 * hashed (the worker does the same), never cut.
 */
export function liveJobId(id: string): string {
  if (id.length <= MAX_JOB_ID) return id;
  return `sha256:${createHash("sha256").update(id).digest("hex").slice(0, 40)}`;
}

/** True when the event should be sent now; otherwise it was parked. */
async function parkUnlessWatched(body: LiveEvent): Promise<boolean> {
  try {
    const watched = await upstashEval<number>({
      script: PARK_SCRIPT,
      keys: [WATCHING_KEY, PARKED_KEY],
      args: [JSON.stringify(body), FEED_EVENTS, MAX_PARKED_EVENT_AGE_MS],
    });
    return watched === 1;
  } catch {
    return true;
  }
}

/**
 * For the worker, with a dashboard open: marks the feed watched and returns
 * the events parked meanwhile, oldest first.
 */
export async function drainParkedEvents(): Promise<LiveEvent[]> {
  const parked = await upstashEval<string[] | null>({
    script: DRAIN_SCRIPT,
    keys: [WATCHING_KEY, PARKED_KEY],
    args: [FEED_WATCH_MS],
  });
  return (parked ?? []).flatMap((text) => {
    try {
      const event = JSON.parse(text) as unknown;
      return event && typeof event === "object" && !Array.isArray(event)
        ? [event as LiveEvent]
        : [];
    } catch {
      return [];
    }
  });
}

/** Whether a request carries the worker's shared secret. */
export function isPresenceWorker(request: Request): boolean {
  const secret = presenceSecret();
  if (!secret) return false;
  const digest = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(
    digest(request.headers.get("authorization") ?? ""),
    digest(`Bearer ${secret}`),
  );
}

async function send(event: LiveEvent): Promise<void> {
  const url = presenceSocketUrl();
  const secret = presenceSecret();
  if (!url || !secret) return;
  // Stamped here, so an event that waited in Redis keeps its own time.
  const body: LiveEvent = {
    ...event,
    at: Date.now(),
    ...(event.job
      ? { job: { ...event.job, id: liveJobId(event.job.id) } }
      : {}),
  };
  // Signing out everywhere must close open dashboards now: never parked.
  if (event.kind !== SIGNED_OUT_EVERYWHERE && !(await parkUnlessWatched(body)))
    return;
  try {
    const response = await fetch(`${url.replace(/^ws/, "http")}/event`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    // Nothing in the body is needed; letting it go frees the connection.
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok)
      logEvent("warn", "admin.live_event.rejected", {
        kind: event.kind,
        status: response.status,
      });
  } catch {
    // The feed is a convenience; the logs remain the record.
  }
}

/**
 * Send an event to the dashboard. The returned promise never rejects; inside a
 * request it is also handed to after(), so the function stays up until sent.
 */
export function emitLiveEvent(event: LiveEvent): Promise<void> {
  const task = send(event);
  try {
    after(task);
  } catch {
    // Outside a request scope: the caller keeps the process alive.
  }
  return task;
}

/** Where a request came from, coarsely, for the dashboard feed. */
export function requestOrigin(request: Request) {
  const { country, region, city } = requestGeo(request);
  return {
    country,
    region,
    city: city.slice(0, 60),
    device: isDesktopRequest(request) ? "desktop" : "mobile",
  };
}
