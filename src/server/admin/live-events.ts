import "server-only";

import { createHmac } from "node:crypto";
import { after } from "next/server";

import { isDesktopRequest } from "~/server/explainer/audience";

// Sends what the site is doing (generations starting and finishing, visitors
// held back by the video gate, switches flipped) to the presence worker
// (workers/presence), which pushes each event to the operator's open dashboard
// the moment it arrives. Sending is best effort and never slows or fails the
// request it describes.

const SEND_TIMEOUT_MS = 2_000;
const DASHBOARD_TOKEN_MS = 10 * 60_000;

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

async function send(event: LiveEvent): Promise<void> {
  const url = presenceSocketUrl();
  const secret = presenceSecret();
  if (!url || !secret) return;
  try {
    await fetch(`${url.replace(/^ws/, "http")}/event`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
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

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Where a request came from, coarsely, for the dashboard feed. */
export function requestOrigin(request: Request) {
  const headers = request.headers;
  return {
    country: headers.get("x-vercel-ip-country") ?? "",
    region: headers.get("x-vercel-ip-country-region") ?? "",
    city: safeDecode(headers.get("x-vercel-ip-city") ?? "").slice(0, 60),
    device: isDesktopRequest(request) ? "desktop" : "mobile",
  };
}
