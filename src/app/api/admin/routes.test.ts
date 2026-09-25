import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Every /admin API route but sign-in: signed-out callers get 401, and a
// signed-in browser's cookie cannot be ridden from another site (403).

const mocks = vi.hoisted(() => ({
  writeControls: vi.fn(),
  resetUsageToday: vi.fn(),
  readAdminState: vi.fn(),
  setClaudeCredit: vi.fn(),
  emitLiveEvent: vi.fn(async () => undefined),
}));

vi.mock("~/server/storage/upstash", () => ({
  // The session generation: never signed out everywhere.
  upstashCommand: vi.fn(async () => "0"),
}));
vi.mock("~/server/admin/controls", () => ({
  ControlsUnconfirmedError: class extends Error {},
  writeControls: mocks.writeControls,
}));
vi.mock("~/server/explainer/limits", () => ({
  resetUsageToday: mocks.resetUsageToday,
}));
vi.mock("~/server/admin/state", () => ({
  readAdminState: mocks.readAdminState,
}));
vi.mock("~/server/admin/claude-credit", () => ({
  setClaudeCredit: mocks.setClaudeCredit,
}));
vi.mock("~/server/admin/live-events", () => ({
  emitLiveEvent: mocks.emitLiveEvent,
}));

import {
  ADMIN_SESSION_COOKIE,
  createAdminSession,
} from "~/server/admin/operator";
import { POST as claudeCredit } from "./claude-credit/route";
import { POST as controls } from "./controls/route";
import { POST as reset } from "./reset/route";
import { GET as state } from "./state/route";

const TOKEN = "a".repeat(40);
const originalEnv = process.env;
let cookie: string;

beforeEach(async () => {
  process.env = { ...originalEnv, VIDEO_ADMIN_TOKEN: TOKEN };
  cookie = `${ADMIN_SESSION_COOKIE}=${(await createAdminSession())!.value}`;
  mocks.writeControls.mockResolvedValue({ videosPaused: true });
  mocks.resetUsageToday.mockResolvedValue(3);
  mocks.readAdminState.mockResolvedValue({ now: 1 });
  mocks.setClaudeCredit.mockResolvedValue({
    setUsd: 20,
    setAt: 5,
    spentUsd: 0,
  });
});
afterEach(() => {
  process.env = originalEnv;
  vi.clearAllMocks();
});

function post(
  path: string,
  body: unknown,
  { signedIn = true, origin = "https://gitdiagram.com" } = {},
) {
  return new Request(`https://gitdiagram.com${path}`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...(signedIn ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

const MUTATIONS = [
  {
    name: "controls",
    route: controls,
    path: "/api/admin/controls",
    body: { videosPaused: true },
    work: mocks.writeControls,
  },
  {
    name: "reset",
    route: reset,
    path: "/api/admin/reset",
    body: { target: "videos" },
    work: mocks.resetUsageToday,
  },
  {
    name: "claude-credit",
    route: claudeCredit,
    path: "/api/admin/claude-credit",
    body: { usd: 20 },
    work: mocks.setClaudeCredit,
  },
] as const;

describe("admin API routes", () => {
  it.each(MUTATIONS)(
    "$name: 401 signed out, 403 from another site, 200 signed in",
    async ({ route, path, body, work }) => {
      expect((await route(post(path, body, { signedIn: false }))).status).toBe(
        401,
      );
      expect(
        (await route(post(path, body, { origin: "https://evil.example" })))
          .status,
      ).toBe(403);
      expect(work).not.toHaveBeenCalled();
      expect((await route(post(path, body))).status).toBe(200);
      expect(work).toHaveBeenCalledTimes(1);
    },
  );

  it("state: 401 signed out", async () => {
    const read = (headers: HeadersInit = {}) =>
      state(new Request("https://gitdiagram.com/api/admin/state", { headers }));
    expect((await read()).status).toBe(401);
    expect(mocks.readAdminState).not.toHaveBeenCalled();
    const response = await read({ cookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ now: 1 });
  });

  it("controls: refuses an empty change, which would only fill the feed", async () => {
    expect((await controls(post("/api/admin/controls", {}))).status).toBe(400);
    expect(mocks.writeControls).not.toHaveBeenCalled();
    expect(mocks.emitLiveEvent).not.toHaveBeenCalled();
  });

  it("claude-credit: answers with the new credit", async () => {
    const response = await claudeCredit(
      post("/api/admin/claude-credit", { usd: 20 }),
    );
    expect(await response.json()).toEqual({
      ok: true,
      credit: { setUsd: 20, setAt: 5, spentUsd: 0 },
    });
  });
});
