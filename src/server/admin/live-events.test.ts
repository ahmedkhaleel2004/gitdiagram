import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  after: () => {
    throw new Error("Outside a request");
  },
}));

import {
  DASHBOARD_TOKEN_MS,
  tokenExpiry,
} from "~/features/admin/presence-protocol";
import { createPresenceToken, emitLiveEvent, liveJobId } from "./live-events";

const SECRET = "p".repeat(40);
const originalEnv = process.env;

beforeEach(() => {
  process.env = {
    ...originalEnv,
    PRESENCE_SECRET: SECRET,
    NEXT_PUBLIC_PRESENCE_URL: "wss://presence.example.dev/",
  };
});
afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
});

describe("dashboard tokens", () => {
  it("mints the `<expiry>.<hmac>` tokens the worker checks", () => {
    const now = 1_800_000_000_000;
    const token = createPresenceToken(now)!;
    expect(tokenExpiry(token)).toBe(now + DASHBOARD_TOKEN_MS);
    const [expiry, signature] = token.split(".");
    expect(signature).toBe(
      createHmac("sha256", SECRET)
        .update(`presence-admin:${expiry}`)
        .digest("hex"),
    );
  });

  it("mints nothing without a long enough secret", () => {
    process.env.PRESENCE_SECRET = "short";
    expect(createPresenceToken()).toBeNull();
  });
});

describe("job ids", () => {
  it("hashes long ids instead of cutting them, so similar jobs stay apart", () => {
    const repo = `acme/${"x".repeat(110)}`;
    const landscape = liveJobId(`render:${repo}:landscape:1`);
    const vertical = liveJobId(`render:${repo}:vertical:1`);
    expect(landscape).not.toBe(vertical);
    expect(landscape).toMatch(/^sha256:[0-9a-f]{40}$/);
    expect(liveJobId("video:acme/app:1")).toBe("video:acme/app:1");
  });

  it("sends the same id for a job's start and end", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"));
    const id = `render:acme/${"y".repeat(130)}:vertical:1`;
    await emitLiveEvent({
      kind: "render.started",
      job: { id, state: "start" },
    });
    await emitLiveEvent({ kind: "render.finished", job: { id, state: "end" } });
    const sent = fetch.mock.calls.map(
      ([, init]) => JSON.parse(String(init?.body)) as { job: { id: string } },
    );
    expect(fetch.mock.calls[0]?.[0]).toBe("https://presence.example.dev/event");
    expect(sent[0]?.job.id).toBe(liveJobId(id));
    expect(sent[1]?.job.id).toBe(sent[0]?.job.id);
  });
});

describe("sending events", () => {
  it("lets go of the answer's body, and logs a refusal", async () => {
    const response = new Response("nope", { status: 401 });
    const cancel = vi.spyOn(response.body!, "cancel");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      emitLiveEvent({ kind: "video.started" }),
    ).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalled();
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
      event: "admin.live_event.rejected",
      kind: "video.started",
      status: 401,
    });
  });

  it("never fails the request it describes", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(
      emitLiveEvent({ kind: "video.started" }),
    ).resolves.toBeUndefined();
  });
});
