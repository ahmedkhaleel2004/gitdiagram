import { normalizeVisitor } from "./presence";
import {
  FEED_EVENTS,
  PRESENCE_PROTOCOL,
  tokenExpiry,
} from "./presence-protocol";
import type {
  LiveFeedEvent,
  LiveJob,
  LiveVisitor,
  PresenceMessage,
} from "./types";

// The dashboard's view of the presence worker: what one socket has been told
// so far, and when to try again after it drops. Pure, so it is tested
// without a socket (live-link.test.ts).

export interface LiveSite {
  visitors: Record<string, LiveVisitor>;
  events: LiveFeedEvent[];
  jobs: LiveJob[];
  peak: { day: string; count: number; at: number } | null;
  /**
   * The operator's clock minus the worker's, from the last snapshot. Times
   * the worker stamps (hidden since, connected, started) are moved onto the
   * operator's clock with it, so "2 minutes" means two minutes here.
   */
  offset: number;
  /** When the last message that changed anything arrived (operator's clock). */
  at: number;
  /**
   * The worker's PRESENCE_PROTOCOL, from the last snapshot: null before one
   * arrives, 0 from a worker older than protocol versions.
   */
  protocol: number | null;
}

export const EMPTY_SITE: LiveSite = {
  visitors: {},
  events: [],
  jobs: [],
  peak: null,
  offset: 0,
  at: 0,
  protocol: null,
};

/**
 * Whether the worker speaks another version of the protocol than this site:
 * one of the two was deployed without the other.
 */
export function isProtocolMismatch(site: Pick<LiveSite, "protocol">): boolean {
  return site.protocol !== null && site.protocol !== PRESENCE_PROTOCOL;
}

/** A message from the worker, and when it arrived on the operator's clock. */
export interface Received {
  message: PresenceMessage;
  at: number;
}

const local = (ms: number, offset: number) => (ms > 0 ? ms + offset : ms);

function visitorHere(raw: LiveVisitor, offset: number): LiveVisitor {
  const visitor = normalizeVisitor(raw);
  return {
    ...visitor,
    h: local(visitor.h, offset),
    t: local(visitor.t, offset),
  };
}

export function reduceSite(site: LiveSite, received: Received): LiveSite {
  const next = apply(site, received);
  return next === site ? site : { ...next, at: received.at };
}

function apply(site: LiveSite, { message, at }: Received): LiveSite {
  switch (message.type) {
    case "snapshot": {
      const offset = at - message.now;
      return {
        visitors: Object.fromEntries(
          message.visitors.map((v) => [v.id, visitorHere(v, offset)]),
        ),
        events: message.events
          .slice(0, FEED_EVENTS)
          .map((event) => ({ ...event, at: local(event.at, offset) })),
        jobs: message.jobs.map((job) => ({
          ...job,
          started: local(job.started, offset),
        })),
        peak: { ...message.peak, at: local(message.peak.at, offset) },
        offset,
        at,
        protocol: typeof message.protocol === "number" ? message.protocol : 0,
      };
    }
    case "join":
      return {
        ...site,
        visitors: {
          ...site.visitors,
          [message.visitor.id]: visitorHere(message.visitor, site.offset),
        },
      };
    case "update": {
      const visitor = site.visitors[message.id];
      if (!visitor) return site;
      return {
        ...site,
        visitors: {
          ...site.visitors,
          [message.id]: {
            ...visitor,
            ...(message.p !== undefined ? { p: message.p } : {}),
            ...(message.v !== undefined ? { v: message.v } : {}),
            ...(message.h !== undefined
              ? { h: local(message.h, site.offset) }
              : {}),
          },
        },
      };
    }
    case "leave": {
      if (!site.visitors[message.id]) return site;
      const visitors = { ...site.visitors };
      delete visitors[message.id];
      return { ...site, visitors };
    }
    case "event":
      if (site.events.some((event) => event.id === message.event.id))
        return site;
      return {
        ...site,
        events: [
          { ...message.event, at: local(message.event.at, site.offset) },
          ...site.events,
        ].slice(0, FEED_EVENTS),
      };
    case "jobs":
      return {
        ...site,
        jobs: message.jobs.map((job) => ({
          ...job,
          started: local(job.started, site.offset),
        })),
      };
    case "peak":
      return {
        ...site,
        peak: { ...message.peak, at: local(message.peak.at, site.offset) },
      };
    default:
      // A message from a newer worker than this dashboard knows.
      return site;
  }
}

/**
 * How long to wait before reconnecting after `attempt` failures in a row:
 * 1 s, doubling to 30 s, then up to twice that at random so a worker deploy
 * does not bring every dashboard back at the same moment.
 */
export function reconnectDelay(
  attempt: number,
  random = Math.random(),
): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (1 + random));
}

// A token this close to expiry would expire before the worker checks it.
const TOKEN_MARGIN_MS = 15_000;

/** Whether a dashboard token is still good enough to open a socket with. */
export function isTokenFresh(token: string, now: number): boolean {
  const expires = tokenExpiry(token);
  return expires === null || expires - now > TOKEN_MARGIN_MS;
}
