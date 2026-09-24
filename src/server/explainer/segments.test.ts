import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createHmac } from "node:crypto";
import { verifySegmentJob, type SegmentJob } from "./segments";

const originalEnv = { ...process.env };
const job = (): SegmentJob => ({
  username: "Owner",
  repo: "Repo",
  v: "2026-09-24T08:06:45.297Z",
  format: "landscape",
  from: 300,
  to: 600,
  exp: Date.now() + 60_000,
});
const sign = (value: SegmentJob) =>
  createHmac("sha256", "secret")
    .update(
      `video-segment:${[value.username.toLowerCase(), value.repo.toLowerCase(), value.v, value.format, value.from, value.to, value.exp].join("|")}`,
    )
    .digest("hex");

beforeEach(() => {
  process.env = { ...originalEnv, CACHE_KEY_SECRET: "secret" };
});
afterEach(() => {
  process.env = { ...originalEnv };
});

describe("render segment signatures", () => {
  it("accepts the exact job it was signed for", () => {
    const value = job();
    expect(verifySegmentJob(value, sign(value))).toBe(true);
  });

  it("rejects a changed job, an expired one or a bad signature", () => {
    const value = job();
    const signature = sign(value);
    expect(verifySegmentJob({ ...value, to: 900 }, signature)).toBe(false);
    expect(verifySegmentJob({ ...value, format: "vertical" }, signature)).toBe(
      false,
    );
    const expired = { ...value, exp: Date.now() - 1 };
    expect(verifySegmentJob(expired, sign(expired))).toBe(false);
    expect(verifySegmentJob(value, "nope")).toBe(false);
  });
});
