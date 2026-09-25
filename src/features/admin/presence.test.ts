import { describe, expect, it } from "vitest";

import { isLikelyVpn, offsetMinutes, peopleHere, RECENT_MS } from "./presence";
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

describe("likely VPN", () => {
  it("reads time zone offsets", () => {
    const summer = new Date("2026-07-01T12:00:00Z");
    expect(offsetMinutes("America/New_York", summer)).toBe(-240);
    expect(offsetMinutes("Asia/Kolkata", summer)).toBe(330);
    expect(offsetMinutes("Etc/UTC", summer)).toBe(0);
    expect(offsetMinutes("Not/AZone", summer)).toBeNull();
  });

  it("flags a browser clock that disagrees with its IP address", () => {
    expect(
      isLikelyVpn(tab({ z: "Asia/Calcutta", iz: "America/New_York" }), NOW),
    ).toBe(true);
    // Different names, same offset: not a mismatch.
    expect(
      isLikelyVpn(tab({ z: "America/Toronto", iz: "America/New_York" }), NOW),
    ).toBe(false);
    expect(isLikelyVpn(tab({ z: "", iz: "America/New_York" }), NOW)).toBe(
      false,
    );
  });
});
