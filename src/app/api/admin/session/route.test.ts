import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as RouteModule from "./route";

vi.mock("server-only", () => ({}));

const redis = vi.hoisted(() => ({
  down: false,
  generation: 0,
  failures: new Map<string, number>(),
  announced: new Set<string>(),
}));

vi.mock("~/server/storage/upstash", () => ({
  upstashCommand: vi.fn(async (command: unknown[]) => {
    if (redis.down) throw new Error("Upstash request timed out.");
    if (command[0] === "GET") return String(redis.generation);
    if (command[0] === "INCR") return ++redis.generation;
    throw new Error("Unexpected command");
  }),
  // The sign-in guard's script, played out in memory for speed (the real
  // script runs against Redis in sign-in-guard.redis.test.ts).
  upstashEval: vi.fn(
    async ({ keys, args }: { keys: string[]; args: unknown[] }) => {
      if (redis.down) throw new Error("Upstash request timed out.");
      const [failures, announced] = keys as [string, string];
      const max = Number(args[0]);
      const wrong = args[3] === "1";
      const count = (redis.failures.get(failures) ?? 0) + (wrong ? 1 : 0);
      redis.failures.set(failures, count);
      if (wrong ? count > max : count >= max) return [1, 900, 0];
      if (!wrong || redis.announced.has(announced)) return [0, 0, 0];
      redis.announced.add(announced);
      return [0, 0, 1];
    },
  ),
}));

const emitted = vi.hoisted(() => [] as Array<{ kind: string }>);
vi.mock("~/server/admin/live-events", () => ({
  emitLiveEvent: vi.fn(async (event: { kind: string }) => {
    emitted.push(event);
  }),
  requestOrigin: () => ({}),
}));

type Route = typeof RouteModule;
let DELETE: Route["DELETE"];
let GET: Route["GET"];
let POST: Route["POST"];

const TOKEN = "a".repeat(40);
const originalEnv = process.env;

function signIn(token: string, ip = "203.0.113.9") {
  return POST(
    new Request("https://gitdiagram.com/api/admin/session", {
      method: "POST",
      headers: {
        origin: "https://gitdiagram.com",
        "content-type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ token }),
    }),
  );
}

/** Runs a request whose failure path waits, without waiting for real. */
async function settle(response: Promise<Response>): Promise<Response> {
  await vi.runAllTimersAsync();
  return response;
}

const sessionCookie = (response: Response) =>
  response.headers.get("set-cookie")!.split(";")[0]!;

beforeEach(async () => {
  // A fresh server instance: no session generation cached from before.
  vi.resetModules();
  ({ DELETE, GET, POST } = await import("./route"));
  process.env = { ...originalEnv, VIDEO_ADMIN_TOKEN: TOKEN };
  redis.down = false;
  redis.generation = 0;
  redis.failures.clear();
  redis.announced.clear();
  emitted.length = 0;
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = originalEnv;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("admin sign-in", () => {
  it("signs in with the operator token", async () => {
    const response = await signIn(TOKEN);
    expect(response.status).toBe(200);
    expect(sessionCookie(response)).toMatch(/^gd_admin=v2\./);
    expect(emitted.map((event) => event.kind)).toEqual(["admin.signed_in"]);
  });

  it("says the dashboard is not set up when the token is too short", async () => {
    process.env.VIDEO_ADMIN_TOKEN = "short";
    const response = await signIn("short");
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toMatch(
      /not set up/,
    );
    expect(emitted).toEqual([]);
  });

  it("throttles failed sign-ins per network and announces them once", async () => {
    for (let attempt = 0; attempt < 10; attempt++)
      expect((await settle(signIn("wrong"))).status).toBe(401);
    expect(emitted.map((event) => event.kind)).toEqual([
      "admin.sign_in_failed",
    ]);

    const blocked = await signIn(TOKEN);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("900");

    // Another network is unaffected, and announced on its own.
    expect((await settle(signIn("wrong", "198.51.100.7"))).status).toBe(401);
    expect(emitted).toHaveLength(2);
    expect((await signIn(TOKEN, "198.51.100.7")).status).toBe(200);
  });

  it("still lets the operator in while Redis is down", async () => {
    redis.down = true;
    expect((await settle(signIn("wrong"))).status).toBe(401);
    expect((await signIn(TOKEN)).status).toBe(200);
  });
});

describe("admin sign-out", () => {
  const signOut = (cookie: string, everywhere = false) =>
    DELETE(
      new Request(
        `https://gitdiagram.com/api/admin/session${everywhere ? "?everywhere=1" : ""}`,
        {
          method: "DELETE",
          headers: { origin: "https://gitdiagram.com", cookie },
        },
      ),
    );
  const isSignedIn = async (cookie: string) =>
    (
      (await (
        await GET(
          new Request("https://gitdiagram.com/api/admin/session", {
            headers: { cookie },
          }),
        )
      ).json()) as { admin: boolean }
    ).admin;

  it("signs out everywhere, ending other browsers' sessions", async () => {
    const laptop = sessionCookie(await signIn(TOKEN));
    const phone = sessionCookie(await signIn(TOKEN));
    expect(await isSignedIn(phone)).toBe(true);

    expect((await signOut(laptop, true)).status).toBe(200);
    expect(await isSignedIn(phone)).toBe(false);
    expect(emitted.at(-1)?.kind).toBe("admin.signed_out_everywhere");
    // And cannot sign anyone out any more.
    expect((await signOut(phone, true)).status).toBe(401);
  });

  it("signs out one browser without touching the others", async () => {
    const laptop = sessionCookie(await signIn(TOKEN));
    const response = await signOut(laptop);
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect(await isSignedIn(laptop)).toBe(true); // the cookie itself is gone
    expect(redis.generation).toBe(0);
  });
});
