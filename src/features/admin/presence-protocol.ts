// What the site and the presence worker (workers/presence, which imports this
// file) agree on for the dashboard's socket.

/**
 * The dashboard offers this WebSocket subprotocol, followed by its token as a
 * second "protocol", so the token travels in a header instead of the URL
 * (which lands in the Worker's request logs). The worker answers with this
 * name alone.
 */
export const ADMIN_PROTOCOL = "gd-admin";

/** How long a dashboard token the site mints lasts. */
export const DASHBOARD_TOKEN_MS = 10 * 60_000;

/** The longest-lived dashboard token the worker accepts. */
export const MAX_DASHBOARD_TOKEN_MS = 15 * 60_000;

/**
 * Events in the live feed: kept by the worker, sent in a snapshot and kept by
 * the dashboard, so all three show the same history.
 */
export const FEED_EVENTS = 200;

/**
 * Dashboard tokens are `<expiry ms>.<hex hmac>`. When the token expires, or
 * null for something that is not one.
 */
export function tokenExpiry(token: string): number | null {
  const match = /^(\d{1,16})\.[0-9a-f]{64}$/.exec(token);
  if (!match) return null;
  const expires = Number(match[1]);
  return Number.isSafeInteger(expires) ? expires : null;
}

/** The token a dashboard offered in its Sec-WebSocket-Protocol header. */
export function tokenFromProtocols(header: string | null): string | null {
  const offered = (header ?? "").split(",").map((part) => part.trim());
  if (offered[0] !== ADMIN_PROTOCOL || offered.length !== 2) return null;
  return offered[1] || null;
}
