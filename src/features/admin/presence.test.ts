import { describe, expect, it, vi } from "vitest";

import {
  hasClockMismatch,
  isHere,
  nextExpiry,
  normalizeVisitor,
  offsetMinutes,
  peopleHere,
  RECENT_MS,
} from "./presence";
import type { LiveVisitor } from "./types";

const NOW = 1_800_000_000_000;
const tab = (overrides: Partial<LiveVisitor>): LiveVisitor => ({
  id: Math.random().toString(36).slice(2, 10),
  b: "browser1",
  p: "/",
  v: 1,
  h: 0,
  z: "",
  iz: "",
  d: "d",
  c: "US",
  r: "CA",
  ct: "San Francisco",
  la: null,
  lo: null,
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

  it("counts a tab in view, or out of view for under two minutes", () => {
    expect(isHere({ v: 1, h: 0 }, NOW)).toBe(true);
    expect(isHere({ v: 0, h: NOW - RECENT_MS + 1 }, NOW)).toBe(true);
    expect(isHere({ v: 0, h: NOW - RECENT_MS }, NOW)).toBe(false);
  });

  it("shows the page a person is looking at", () => {
    const [person] = peopleHere(
      [tab({ v: 0, h: NOW - 5_000, p: "/old" }), tab({ p: "/now" })],
      NOW,
    );
    expect(person?.p).toBe("/now");
  });

  it("knows when the count next changes on its own", () => {
    expect(nextExpiry([tab({}), tab({ v: 0, h: 0 })], NOW)).toBeNull();
    expect(
      nextExpiry(
        [
          tab({ v: 0, h: NOW - 100_000 }),
          tab({ v: 0, h: NOW - 10_000 }),
          tab({ v: 0, h: NOW - RECENT_MS - 5 }), // already gone
        ],
        NOW,
      ),
    ).toBe(NOW - 100_000 + RECENT_MS);
  });
});

describe("visitors from any worker version", () => {
  it("fills what older workers did not send", () => {
    const visitor = normalizeVisitor({
      id: "abc12345",
      p: "/x",
      v: 0,
    } as LiveVisitor);
    expect(visitor).toMatchObject({
      b: "abc12345",
      h: 0,
      z: "",
      iz: "",
      la: null,
      lo: null,
      v: 0,
    });
    expect(normalizeVisitor(tab({ la: 51.5, lo: -0.12 })).la).toBe(51.5);
  });
});

describe("clock/IP mismatch", () => {
  it("reads time zone offsets", () => {
    const summer = new Date("2026-07-01T12:00:00Z");
    expect(offsetMinutes("America/New_York", summer)).toBe(-240);
    expect(offsetMinutes("Asia/Kolkata", summer)).toBe(330);
    expect(offsetMinutes("Etc/UTC", summer)).toBe(0);
    expect(offsetMinutes("Not/AZone", summer)).toBeNull();
  });

  it("does not remember every made-up zone name it is sent", () => {
    const summer = new Date("2026-07-01T12:00:00Z");
    offsetMinutes("Europe/Paris", summer);
    const created = vi.spyOn(Intl, "DateTimeFormat");
    offsetMinutes("Europe/Paris", summer);
    expect(created).not.toHaveBeenCalled();
    for (let index = 0; index < 1_000; index++)
      expect(offsetMinutes(`Fake/Zone${index}`, summer)).toBeNull();
    // The cache started over along the way, so Paris is looked up afresh.
    created.mockClear();
    expect(offsetMinutes("Europe/Paris", summer)).toBe(120);
    expect(created).toHaveBeenCalledTimes(1);
    created.mockRestore();
  });

  it("flags a browser clock that disagrees with its IP address", () => {
    expect(
      hasClockMismatch(
        tab({ z: "Asia/Calcutta", iz: "America/New_York" }),
        NOW,
      ),
    ).toBe(true);
    // Different names, same offset: not a mismatch.
    expect(
      hasClockMismatch(
        tab({ z: "America/Toronto", iz: "America/New_York" }),
        NOW,
      ),
    ).toBe(false);
    expect(hasClockMismatch(tab({ z: "", iz: "America/New_York" }), NOW)).toBe(
      false,
    );
  });

  it("does not flag browsers that report UTC to hide their zone", () => {
    for (const zone of ["UTC", "Etc/UTC", "Etc/GMT", "GMT", "Etc/GMT+5"])
      expect(
        hasClockMismatch(tab({ z: zone, iz: "America/New_York" }), NOW),
      ).toBe(false);
  });
});
