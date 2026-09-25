import { describe, expect, it } from "vitest";

import {
  ADMIN_PROTOCOL,
  tokenFromProtocols,
} from "../../../src/features/admin/presence-protocol";
import type { LiveVisitor } from "../../../src/features/admin/types";
import {
  adminTokenExpiry,
  coordinate,
  countMessage,
  hostOf,
  isFresh,
  jobKey,
  MAX_FRAMES_PER_WINDOW,
  MAX_MESSAGES_PER_WINDOW,
  MESSAGE_WINDOW_MS,
  Outbox,
  rollPeak,
  sameText,
  STALE_MS,
} from "./logic";

const NOW = 1_800_000_000_000;
const SECRET = "s".repeat(40);

const visitor = (id: string): LiveVisitor => ({
  id,
  b: `browser${id}`,
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
});

/** A token exactly as the site mints it (src/server/admin/live-events.ts). */
async function siteToken(expires: number, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`presence-admin:${expires}`),
  );
  const hex = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${expires}.${hex}`;
}

describe("message allowance", () => {
  it("closes a socket that sends more than a person would", () => {
    let state: { mw?: number; mc?: number } = {};
    for (let sent = 1; sent <= MAX_MESSAGES_PER_WINDOW; sent++) {
      const result = countMessage(state, NOW + sent);
      expect(result.allowed).toBe(true);
      state = result;
    }
    expect(countMessage(state, NOW + 100).allowed).toBe(false);
    // A new minute starts a new allowance.
    expect(countMessage(state, NOW + MESSAGE_WINDOW_MS + 1)).toMatchObject({
      allowed: true,
      mc: 1,
      mf: 1,
    });
  });

  it("does not hold messages that change nothing against a person, up to a point", () => {
    let state: { mw?: number; mc?: number; mf?: number } = {};
    for (let sent = 1; sent <= MAX_FRAMES_PER_WINDOW; sent++) {
      const result = countMessage(state, NOW + sent, false);
      expect(result.allowed).toBe(true);
      state = result;
    }
    expect(state).toMatchObject({ mc: 0, mf: MAX_FRAMES_PER_WINDOW });
    expect(countMessage(state, NOW + 200, false).allowed).toBe(false);
  });

  it("reads allowances written before frames were counted", () => {
    expect(countMessage({ mw: NOW, mc: 3 }, NOW + 1)).toMatchObject({
      mc: 4,
      mf: 1,
      allowed: true,
    });
  });
});

describe("referrers", () => {
  it("keeps only the referring host, from an address or a bare host", () => {
    expect(hostOf("https://news.example.com/item?id=1")).toBe(
      "news.example.com",
    );
    expect(hostOf("https://news.example.com")).toBe("news.example.com");
    expect(hostOf("News.Example.com:8443")).toBe("news.example.com:8443");
    expect(hostOf("not a host")).toBe("");
    expect(hostOf(null)).toBe("");
  });
});

describe("fresh sockets", () => {
  it("trusts a new socket, then only one whose pings are answered", () => {
    expect(isFresh(NOW - 1_000, null, NOW, STALE_MS)).toBe(true);
    expect(isFresh(NOW - STALE_MS - 1, null, NOW, STALE_MS)).toBe(false);
    expect(isFresh(NOW - 3_600_000, NOW - 30_000, NOW, STALE_MS)).toBe(true);
    expect(isFresh(NOW - 3_600_000, NOW - STALE_MS - 1, NOW, STALE_MS)).toBe(
      false,
    );
  });
});

describe("job keys", () => {
  it("keeps short ids and hashes long ones instead of cutting them", async () => {
    expect(await jobKey("video:acme/app:1")).toBe("video:acme/app:1");
    const repo = `acme/${"x".repeat(110)}`;
    const landscape = await jobKey(`render:${repo}:landscape:${NOW}`);
    const vertical = await jobKey(`render:${repo}:vertical:${NOW}`);
    expect(landscape).not.toBe(vertical);
    expect(landscape).toMatch(/^sha256:[0-9a-f]{40}$/);
    expect(await jobKey(`render:${repo}:landscape:${NOW}`)).toBe(landscape);
  });
});

describe("daily peak", () => {
  it("rises with the count and starts each day from who is here", () => {
    const today = "2027-01-15";
    expect(rollPeak(null, today, 3, NOW)).toEqual({
      peak: { day: today, count: 3, at: NOW },
      changed: true,
    });
    const stored = { day: today, count: 5, at: NOW - 1 };
    expect(rollPeak(stored, today, 4, NOW)).toEqual({
      peak: stored,
      changed: false,
    });
    expect(rollPeak(stored, today, 6, NOW).peak.count).toBe(6);
    // Midnight: yesterday's 5 does not carry over, and neither does 0.
    expect(rollPeak(stored, "2027-01-16", 2, NOW)).toEqual({
      peak: { day: "2027-01-16", count: 2, at: NOW },
      changed: true,
    });
  });
});

describe("outbox", () => {
  it("merges a visitor's changes into one message", () => {
    const outbox = new Outbox();
    outbox.push({ type: "update", id: "a", p: "/one" });
    outbox.push({ type: "update", id: "a", v: 0, h: NOW });
    outbox.push({ type: "update", id: "a", p: "/two" });
    expect(outbox.drain()).toEqual([
      { type: "update", id: "a", p: "/two", v: 0, h: NOW },
    ]);
    expect(outbox.size).toBe(0);
  });

  it("folds updates into a queued join, and drops a visit too short to show", () => {
    const outbox = new Outbox();
    outbox.push({ type: "join", visitor: visitor("a") });
    outbox.push({ type: "update", id: "a", p: "/later" });
    outbox.push({ type: "join", visitor: visitor("b") });
    outbox.push({ type: "leave", id: "b" });
    outbox.push({ type: "leave", id: "c" });
    expect(outbox.drain()).toEqual([
      { type: "join", visitor: { ...visitor("a"), p: "/later" } },
      { type: "leave", id: "c" },
    ]);
  });

  it("sends only the latest job list and peak", () => {
    const outbox = new Outbox();
    const peak = (count: number) => ({ day: "2027-01-15", count, at: NOW });
    outbox.push({ type: "jobs", jobs: [] });
    outbox.push({ type: "peak", peak: peak(1) });
    outbox.push({
      type: "event",
      event: { id: 1, at: NOW, kind: "diagram.started" },
    });
    outbox.push({ type: "peak", peak: peak(2) });
    const messages = outbox.drain();
    expect(messages.map((message) => message.type)).toEqual([
      "jobs",
      "event",
      "peak",
    ]);
    expect(messages.at(-1)).toEqual({ type: "peak", peak: peak(2) });
  });

  it("does not let a queued message change after it was pushed", () => {
    const outbox = new Outbox();
    const joined = visitor("a");
    outbox.push({ type: "join", visitor: joined });
    outbox.push({ type: "update", id: "a", p: "/x" });
    expect(joined.p).toBe("/");
  });
});

describe("dashboard tokens", () => {
  it("accepts the site's tokens and refuses forged, expired or long ones", async () => {
    const expires = NOW + 10 * 60_000;
    const token = await siteToken(expires);
    expect(await adminTokenExpiry(token, SECRET, NOW)).toBe(expires);
    const forged = await siteToken(expires, "t".repeat(40));
    expect(await adminTokenExpiry(forged, SECRET, NOW)).toBeNull();
    const expired = await siteToken(NOW - 1);
    expect(await adminTokenExpiry(expired, SECRET, NOW)).toBeNull();
    // Longer than the site ever mints (the worker used to allow an hour).
    const long = await siteToken(NOW + 30 * 60_000);
    expect(await adminTokenExpiry(long, SECRET, NOW)).toBeNull();
    expect(await adminTokenExpiry("", SECRET, NOW)).toBeNull();
    expect(await adminTokenExpiry(token, "short", NOW)).toBeNull();
  });

  it("reads the token from the subprotocols a dashboard offers", async () => {
    const token = await siteToken(NOW + 60_000);
    expect(tokenFromProtocols(`${ADMIN_PROTOCOL}, ${token}`)).toBe(token);
    expect(tokenFromProtocols(`${ADMIN_PROTOCOL},${token}`)).toBe(token);
    expect(tokenFromProtocols(token)).toBeNull();
    expect(tokenFromProtocols(`other, ${token}`)).toBeNull();
    expect(tokenFromProtocols(null)).toBeNull();
  });

  it("compares secrets in full", () => {
    expect(sameText("Bearer abc", "Bearer abc")).toBe(true);
    expect(sameText("Bearer abc", "Bearer abd")).toBe(false);
    expect(sameText("Bearer ab", "Bearer abc")).toBe(false);
  });
});

describe("coordinates", () => {
  it("reads Cloudflare's coordinates and rejects nonsense", () => {
    expect(coordinate("51.50720", 90)).toBe(51.5);
    expect(coordinate("-0.12760", 180)).toBe(-0.1);
    expect(coordinate("48.85660", 90)).toBe(48.9);
    expect(coordinate("", 90)).toBeNull();
    expect(coordinate("abc", 90)).toBeNull();
    expect(coordinate("123", 90)).toBeNull();
  });
});
