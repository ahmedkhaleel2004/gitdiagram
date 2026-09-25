import type { LiveVisitor } from "./types";

// How the dashboard turns open tabs into people. A person is one browser,
// however many tabs it has open. They are here now if one of their tabs is in
// view, or was within the last two minutes (they may have switched to their
// editor while a diagram generates). Background tabs left open for longer
// still count as tabs, not as people here.

export const RECENT_MS = 120_000;

function isHere(visitor: LiveVisitor, now: number): boolean {
  return visitor.v === 1 || (visitor.h > 0 && now - visitor.h < RECENT_MS);
}

/** One entry per person here now: their most recently viewed tab. */
export function peopleHere(
  visitors: LiveVisitor[],
  now: number,
): LiveVisitor[] {
  const people = new Map<string, LiveVisitor>();
  for (const visitor of visitors) {
    if (!isHere(visitor, now)) continue;
    const seen = people.get(visitor.b);
    if (!seen || (visitor.v === 1 && seen.v !== 1))
      people.set(visitor.b, visitor);
  }
  return [...people.values()];
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

/**
 * Likely behind a VPN or proxy: the browser's clock is set to a different
 * time zone from where its IP address is. A VPN changes the address, not the
 * laptop's clock. (Travellers who kept their home clock look the same.)
 */
export function isLikelyVpn(visitor: LiveVisitor, now: number): boolean {
  if (!visitor.z || !visitor.iz) return false;
  const at = new Date(now);
  const browser = offsetMinutes(visitor.z, at);
  const address = offsetMinutes(visitor.iz, at);
  return browser !== null && address !== null && browser !== address;
}
