// What the site and the presence worker (workers/presence, which imports this
// file) agree on. The worker is deployed on its own, so the two can drift:
// bump PRESENCE_PROTOCOL with any change to the messages or rules here (or in
// presence.ts and types.ts), and the dashboard warns while they differ.

/**
 * The version of what the worker and the site say to each other. The worker
 * sends it in every snapshot; a dashboard that reads another number (or none,
 * from a worker older than this) shows that one of them needs deploying.
 */
export const PRESENCE_PROTOCOL = 1;

/**
 * The dashboard offers this WebSocket subprotocol, followed by its token as a
 * second "protocol", so the token travels in a header instead of the URL
 * (which lands in the Worker's request logs). The worker answers with this
 * name alone.
 */
export const ADMIN_PROTOCOL = "gd-admin";

/**
 * How long a dashboard token the site mints lasts. Short, because the worker
 * cannot see the admin session: a browser that was signed out (or signed out
 * everywhere) gets no new tokens, so the worker closes its socket when the
 * last one runs out. An open dashboard is handed a new one well before that
 * (every poll brings one).
 */
export const DASHBOARD_TOKEN_MS = 45_000;

/**
 * The longest-lived dashboard token the worker accepts. Sites from before
 * DASHBOARD_TOKEN_MS was shortened minted ten-minute tokens.
 */
export const MAX_DASHBOARD_TOKEN_MS = 15 * 60_000;

/** What a dashboard token's HMAC signs, followed by its expiry. */
export const DASHBOARD_TOKEN_PREFIX = "presence-admin:";

/**
 * The feed event the site sends when the operator signs out everywhere; the
 * worker closes every dashboard socket the moment it arrives.
 */
export const SIGNED_OUT_EVERYWHERE = "admin.signed_out_everywhere";

/**
 * Events in the live feed: kept by the worker, sent in a snapshot and kept by
 * the dashboard, so all three show the same history.
 */
export const FEED_EVENTS = 200;

/** The longest path a tab reports; the worker cuts longer ones. */
export const MAX_PATH = 300;

/**
 * Job ids longer than this are hashed, never cut, by the site and the worker
 * alike, so two long ids that share a beginning (the same repo rendered in
 * two formats) stay two jobs.
 */
export const MAX_JOB_ID = 120;

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
