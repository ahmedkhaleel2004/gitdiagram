import type { LiveVisitor } from "./types";

// How the dashboard turns open tabs into people. A person is one browser,
// however many tabs it has open. They are here now if one of their tabs is in
// view, or was within the last two minutes (they may have switched to their
// editor while a diagram generates). Background tabs left open for longer
// still count as tabs, not as people here.
//
// The presence worker (workers/presence) imports this file too, so the daily
// peak it records and the count the dashboard shows use the same rule.

export const RECENT_MS = 120_000;

export function isHere(
  visitor: Pick<LiveVisitor, "v" | "h">,
  now: number,
): boolean {
  return visitor.v === 1 || (visitor.h > 0 && now - visitor.h < RECENT_MS);
}

/** One entry per person here now: their most recently viewed tab. */
export function peopleHere<T extends Pick<LiveVisitor, "b" | "v" | "h">>(
  visitors: Iterable<T>,
  now: number,
): T[] {
  const people = new Map<string, T>();
  for (const visitor of visitors) {
    if (!isHere(visitor, now)) continue;
    const seen = people.get(visitor.b);
    if (!seen || (visitor.v === 1 && seen.v !== 1))
      people.set(visitor.b, visitor);
  }
  return [...people.values()];
}

/**
 * When the count of people here next changes on its own (a background tab
 * passing two minutes), or null if nothing is waiting to expire. Everything
 * else that changes it arrives as a message.
 */
export function nextExpiry(
  visitors: Iterable<Pick<LiveVisitor, "v" | "h">>,
  now: number,
): number | null {
  let next: number | null = null;
  for (const visitor of visitors) {
    if (visitor.v === 1 || visitor.h <= 0) continue;
    const at = visitor.h + RECENT_MS;
    if (at > now && (next === null || at < next)) next = at;
  }
  return next;
}

/**
 * A visitor as a worker of any version sends it: tabs from before browser
 * ids, hidden times, time zones or coordinates existed get neutral values.
 */
export function normalizeVisitor(
  raw: Partial<LiveVisitor> & Pick<LiveVisitor, "id">,
): LiveVisitor {
  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    id: raw.id,
    b: raw.b || raw.id,
    p: raw.p || "/",
    v: raw.v === 0 ? 0 : 1,
    h: raw.h ?? 0,
    z: raw.z ?? "",
    iz: raw.iz ?? "",
    d: raw.d === "m" ? "m" : "d",
    c: raw.c ?? "",
    r: raw.r ?? "",
    ct: raw.ct ?? "",
    la: number(raw.la),
    lo: number(raw.lo),
    ref: raw.ref ?? "",
    t: raw.t ?? 0,
  };
}

const formats = new Map<string, Intl.DateTimeFormat | null>();

/** A time zone's offset from UTC at a moment, in minutes; null if unknown. */
export function offsetMinutes(timeZone: string, at: Date): number | null {
  if (!formats.has(timeZone)) {
    try {
      formats.set(
        timeZone,
        new Intl.DateTimeFormat("en-US", {
          timeZone,
          timeZoneName: "longOffset",
        }),
      );
    } catch {
      formats.set(timeZone, null);
    }
  }
  const name = formats
    .get(timeZone)
    ?.formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;
  if (!name) return null;
  if (name === "GMT") return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name);
  if (!match) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

// Zones a browser reports when it hides the real one (Firefox's and Tor's
// resistFingerprinting, some privacy tools) or when a server or container
// never had one set. They say nothing about where the person is.
const NEUTRAL_ZONE = /^(?:Etc\/.*|UTC|UCT|GMT|Universal|Zulu|Greenwich)$/i;

/**
 * The browser's clock is set to a different time zone from where its IP
 * address is. Often a VPN or proxy (which changes the address, not the
 * laptop's clock), but also travellers who kept their home clock, carrier
 * gateways that place phones in another zone, and places near a zone line,
 * so the dashboard calls it a clock/IP mismatch, not a VPN. Browsers that
 * report UTC are skipped: that is a privacy setting, not a location.
 */
export function hasClockMismatch(
  visitor: Pick<LiveVisitor, "z" | "iz">,
  now: number,
): boolean {
  if (!visitor.z || !visitor.iz || NEUTRAL_ZONE.test(visitor.z)) return false;
  const at = new Date(now);
  const browser = offsetMinutes(visitor.z, at);
  const address = offsetMinutes(visitor.iz, at);
  return browser !== null && address !== null && browser !== address;
}

/** @deprecated Renamed; kept until the dashboard moves over. */
export const isLikelyVpn = hasClockMismatch;
