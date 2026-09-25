import { describe, expect, it } from "vitest";

import {
  EMPTY_SITE,
  isTokenFresh,
  reconnectDelay,
  reduceSite,
  type LiveSite,
} from "./live-link";
import { FEED_EVENTS } from "./presence-protocol";
import type { LiveVisitor, PresenceMessage } from "./types";

const NOW = 1_800_000_000_000;
const SIG = "a".repeat(64);

const visitor = (overrides: Partial<LiveVisitor> = {}): LiveVisitor => ({
  id: "tab1",
  b: "browser1",
  p: "/",
  v: 1,
  h: 0,
  z: "",
  iz: "",
  d: "d",
  c: "US",
  r: "CA",
  ct: "",
  la: null,
  lo: null,
  ref: "",
  t: NOW,
  ...overrides,
});

const snapshot = (
  overrides: Partial<Extract<PresenceMessage, { type: "snapshot" }>> = {},
): PresenceMessage => ({
  type: "snapshot",
  now: NOW,
  visitors: [],
  events: [],
  jobs: [],
  peak: { day: "2027-01-15", count: 0, at: 0 },
  ...overrides,
});

const receive = (site: LiveSite, message: PresenceMessage, at = NOW) =>
  reduceSite(site, { message, at });

describe("the dashboard's live state", () => {
  it("moves the worker's times onto the operator's clock", () => {
    // The operator's clock runs 30 s ahead of the worker's.
    const site = receive(
      EMPTY_SITE,
      snapshot({
        visitors: [visitor({ v: 0, h: NOW - 60_000 })],
        jobs: [{ id: "j", kind: "video", label: "a/b", started: NOW - 5_000 }],
        peak: { day: "2027-01-15", count: 3, at: NOW - 1_000 },
      }),
      NOW + 30_000,
    );
    expect(site.offset).toBe(30_000);
    expect(site.visitors.tab1?.h).toBe(NOW - 30_000);
    expect(site.jobs[0]?.started).toBe(NOW + 25_000);
    expect(site.peak?.at).toBe(NOW + 29_000);

    const hidden = receive(
      site,
      { type: "update", id: "tab1", v: 0, h: NOW + 1_000 },
      NOW + 31_000,
    );
    expect(hidden.visitors.tab1?.h).toBe(NOW + 31_000);
    // In view again: 0 stays 0.
    expect(
      receive(hidden, { type: "update", id: "tab1", v: 1, h: 0 }).visitors.tab1
        ?.h,
    ).toBe(0);
  });

  it("fills in visitors from older workers", () => {
    const old = { ...visitor(), la: undefined, lo: undefined, z: undefined };
    const site = receive(
      EMPTY_SITE,
      snapshot({ visitors: [old as unknown as LiveVisitor] }),
    );
    expect(site.visitors.tab1).toMatchObject({ la: null, lo: null, z: "" });
  });

  it("keeps the feed to the same length the worker does, without repeats", () => {
    let site = receive(EMPTY_SITE, snapshot());
    for (let id = 1; id <= FEED_EVENTS + 5; id++)
      site = receive(site, {
        type: "event",
        event: { id, at: NOW, kind: "diagram.started" },
      });
    expect(site.events).toHaveLength(FEED_EVENTS);
    expect(site.events[0]?.id).toBe(FEED_EVENTS + 5);
    const again = receive(site, {
      type: "event",
      event: { id: FEED_EVENTS + 5, at: NOW, kind: "diagram.started" },
    });
    expect(again).toBe(site);
  });

  it("ignores messages it does not know, and notes when anything changed", () => {
    const site = receive(EMPTY_SITE, snapshot(), NOW);
    expect(site.at).toBe(NOW);
    const unknown = { type: "something-new" } as unknown as PresenceMessage;
    expect(receive(site, unknown, NOW + 5)).toBe(site);
    expect(receive(site, { type: "leave", id: "nobody" }, NOW + 5)).toBe(site);
    expect(
      receive(site, { type: "join", visitor: visitor() }, NOW + 9).at,
    ).toBe(NOW + 9);
  });
});

describe("reconnecting", () => {
  it("backs off from about a second to at most a minute, at random", () => {
    expect(reconnectDelay(0, 0)).toBe(1_000);
    expect(reconnectDelay(0, 0.999)).toBeLessThan(2_000);
    expect(reconnectDelay(3, 0)).toBe(8_000);
    expect(reconnectDelay(20, 0)).toBe(30_000);
    expect(reconnectDelay(20, 1)).toBe(60_000);
  });

  it("does not connect with a token about to expire", () => {
    expect(isTokenFresh(`${NOW + 600_000}.${SIG}`, NOW)).toBe(true);
    expect(isTokenFresh(`${NOW + 5_000}.${SIG}`, NOW)).toBe(false);
    expect(isTokenFresh(`${NOW - 1}.${SIG}`, NOW)).toBe(false);
    // Not a token this dashboard understands: let the worker decide.
    expect(isTokenFresh("opaque", NOW)).toBe(true);
  });
});
