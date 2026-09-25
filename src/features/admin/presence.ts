import type { LiveVisitor } from "./types";

// How the dashboard turns open tabs into people. A person is one browser,
// however many tabs it has open. They are here now if one of their tabs is in
// view, or was within the last two minutes (they may have switched to their
// editor while a diagram generates). Background tabs left open for longer
// still count as tabs, not as people here.

export const RECENT_MS = 120_000;

export function isHere(visitor: LiveVisitor, now: number): boolean {
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
