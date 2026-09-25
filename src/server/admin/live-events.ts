import "server-only";

import { createHash, createHmac } from "node:crypto";
import { after } from "next/server";

import { DASHBOARD_TOKEN_MS } from "~/features/admin/presence-protocol";
import { isDesktopRequest } from "~/server/explainer/audience";
import { requestGeo } from "~/server/http/vercel-geo";
import { logEvent } from "~/server/log";

// Sends what the site is doing (generations starting and finishing, visitors
// held back by the video gate, switches flipped) to the presence worker
// (workers/presence), which pushes each event to the operator's open dashboard
// the moment it arrives. Sending is best effort and never slows or fails the
// request it describes.

const SEND_TIMEOUT_MS = 2_000;
// The worker keeps job ids up to this long. Longer ones are hashed here (the
// worker does the same), never cut: cutting can drop the part that tells two
// jobs apart, such as the format of two renders of one repo.
const MAX_JOB_ID = 120;

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

/** A short-lived token that lets the dashboard open the worker's admin socket. */
export function createPresenceToken(now = Date.now()): string | null {
  const secret = presenceSecret();
  if (!secret) return null;
  const expires = now + DASHBOARD_TOKEN_MS;
  const signature = createHmac("sha256", secret)
    .update(`presence-admin:${expires}`)
    .digest("hex");
  return `${expires}.${signature}`;
}

/** The id a job is known by in the feed: short ids as they are. */
export function liveJobId(id: string): string {
  if (id.length <= MAX_JOB_ID) return id;
  return `sha256:${createHash("sha256").update(id).digest("hex").slice(0, 40)}`;
}

async function send(event: LiveEvent): Promise<void> {
  const url = presenceSocketUrl();
  const secret = presenceSecret();
  if (!url || !secret) return;
  const body = event.job
    ? { ...event, job: { ...event.job, id: liveJobId(event.job.id) } }
    : event;
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
