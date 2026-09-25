import { describe, expect, it } from "vitest";

import { peopleHere, RECENT_MS } from "./presence";
import type { LiveVisitor } from "./types";

const NOW = 1_800_000_000_000;
const tab = (overrides: Partial<LiveVisitor>): LiveVisitor => ({
  id: Math.random().toString(36).slice(2, 10),
  b: "browser1",
  p: "/",
  v: 1,
  h: 0,
  d: "d",
  c: "US",
  r: "CA",
  ct: "San Francisco",
  ref: "",
  t: NOW - 60_000,
  ...overrides,
});

describe("people here now", () => {
  it("counts a browser's tabs as one person", () => {
    const tabs = [tab({}), tab({ v: 0, h: NOW - 10_000 }), tab({ b: "b2" })];
    expect(peopleHere(tabs, NOW)).toHaveLength(2);
  });

  it("keeps someone who looked away briefly, not a long-forgotten tab", () => {
    expect(peopleHere([tab({ v: 0, h: NOW - 30_000 })], NOW)).toHaveLength(1);
    expect(
      peopleHere([tab({ v: 0, h: NOW - RECENT_MS - 1 })], NOW),
    ).toHaveLength(0);
    // Tabs from before hidden times were recorded report 0.
    expect(peopleHere([tab({ v: 0, h: 0 })], NOW)).toHaveLength(0);
  });

  it("shows the page a person is looking at", () => {
    const [person] = peopleHere(
      [tab({ v: 0, h: NOW - 5_000, p: "/old" }), tab({ p: "/now" })],
      NOW,
    );
    expect(person?.p).toBe("/now");
  });
});
