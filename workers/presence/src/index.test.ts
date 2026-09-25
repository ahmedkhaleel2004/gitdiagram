import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_PROTOCOL,
  DASHBOARD_TOKEN_PREFIX,
  HIDDEN_REPORT_MS,
  MAX_PATH,
  PRESENCE_PROTOCOL,
  SIGNED_OUT_EVERYWHERE,
} from "../../../src/features/admin/presence-protocol";
import type { PresenceMessage } from "../../../src/features/admin/types";
import { MAX_MESSAGES_PER_WINDOW } from "./logic";

// The Durable Object and the Worker in front of it, in the Workers runtime
// (@cloudflare/vitest-plugin). Sockets are opened through the Worker as the
// site opens them; `runInDurableObject` reads and ages their attachments.

const SECRET = env.PRESENCE_SECRET;
const ORIGIN = "https://gitdiagram.com";
const BASE = "https://presence.example";

const global = () => env.PRESENCE.get(env.PRESENCE.idFromName("global"));

async function token(expires: number, secret = SECRET): Promise<string> {
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
    new TextEncoder().encode(`${DASHBOARD_TOKEN_PREFIX}${expires}`),
  );
  const hex = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${expires}.${hex}`;
}

let nextIp = 1;
/** A fresh address per socket, so the Worker's connect limit stays out of it. */
const freshIp = () => `198.51.100.${nextIp++}`;

type Socket = WebSocket & { messages: PresenceMessage[] };

function track(ws: WebSocket): Socket {
  const socket = ws as Socket;
  socket.messages = [];
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string" && event.data !== "pong")
      socket.messages.push(JSON.parse(event.data) as PresenceMessage);
  });
  socket.accept();
  return socket;
}

async function visit(
  params: Record<string, string> = {},
  ip = freshIp(),
): Promise<Socket> {
  const query = new URLSearchParams({ p: "/", v: "1", ...params });
  const response = await exports.default.fetch(`${BASE}/v?${query}`, {
    headers: { upgrade: "websocket", origin: ORIGIN, "cf-connecting-ip": ip },
  });
  expect(response.status).toBe(101);
  return track(response.webSocket!);
}

async function dashboard(expires = Date.now() + 45_000): Promise<Socket> {
  const response = await exports.default.fetch(`${BASE}/admin`, {
    headers: {
      upgrade: "websocket",
      "sec-websocket-protocol": `${ADMIN_PROTOCOL}, ${await token(expires)}`,
    },
  });
  expect(response.status).toBe(101);
  expect(response.headers.get("sec-websocket-protocol")).toBe(ADMIN_PROTOCOL);
  return track(response.webSocket!);
}

const closed = (ws: WebSocket) =>
  new Promise<number>((resolve) =>
    ws.addEventListener("close", (event) => resolve(event.code), {
      once: true,
    }),
  );

const postEvent = (body: string, headers: Record<string, string> = {}) =>
  exports.default.fetch(`${BASE}/event`, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}`, ...headers },
    body,
  });

type Attachment = Record<string, unknown> & { k: string };

/** Rewrites every socket's attachment, and makes the object forget its copy. */
function rewrite(
  stub: DurableObjectStub,
  change: (attachment: Attachment) => Attachment,
) {
  return runInDurableObject(stub, (instance, state) => {
    for (const ws of state.getWebSockets())
      ws.serializeAttachment(change(ws.deserializeAttachment() as Attachment));
    (instance as unknown as { roster: null }).roster = null;
  });
}

const attachments = (stub: DurableObjectStub, tag?: string) =>
  runInDurableObject(stub, (_, state) =>
    state
      .getWebSockets(tag)
      .filter((ws) => ws.readyState === WebSocket.OPEN)
      .map((ws) => ws.deserializeAttachment() as Attachment),
  );

afterEach(async () => {
  for (const name of ["global", "caps"])
    await runInDurableObject(
      env.PRESENCE.get(env.PRESENCE.idFromName(name)),
      async (_, state) => {
        for (const ws of state.getWebSockets()) ws.close(1000, "test over");
        await state.storage.deleteAlarm();
      },
    );
});

describe("the Worker's routes", () => {
  it("answers health checks and refuses the unknown", async () => {
    expect(await (await exports.default.fetch(`${BASE}/`)).text()).toBe("ok");
    expect((await exports.default.fetch(`${BASE}/nope`)).status).toBe(404);
  });

  it("only lets the site's own pages open visitor sockets", async () => {
    const response = await exports.default.fetch(`${BASE}/v`, {
      headers: { upgrade: "websocket", origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });

  it("opens a dashboard only for a genuine token sent as a subprotocol", async () => {
    const good = await token(Date.now() + 45_000);
    const open = (url: string, protocol?: string) =>
      exports.default.fetch(url, {
        headers: {
          upgrade: "websocket",
          ...(protocol ? { "sec-websocket-protocol": protocol } : {}),
        },
      });
    // The token in the URL (which lands in logs) is no longer accepted.
    expect((await open(`${BASE}/admin?t=${good}`)).status).toBe(403);
    expect(
      (await open(`${BASE}/admin`, `${ADMIN_PROTOCOL}, ${good.slice(0, -1)}0`))
        .status,
    ).toBe(403);
    const forged = await token(Date.now() + 45_000, "t".repeat(40));
    expect(
      (await open(`${BASE}/admin`, `${ADMIN_PROTOCOL}, ${forged}`)).status,
    ).toBe(403);
    const admin = await dashboard();
    admin.close();
  });

  it("takes events only from the site", async () => {
    const response = await exports.default.fetch(`${BASE}/event`, {
      method: "POST",
      headers: { authorization: "Bearer nope" },
      body: JSON.stringify({ kind: "diagram.start" }),
    });
    expect(response.status).toBe(403);
    expect((await postEvent(JSON.stringify({ kind: "x" }))).status).toBe(200);
  });
});

describe("dashboards", () => {
  it("get a snapshot that says which protocol the worker speaks", async () => {
    await visit({ p: "/acme/app" });
    const admin = await dashboard();
    await vi.waitFor(() => expect(admin.messages.length).toBeGreaterThan(0));
    const snapshot = admin.messages[0]!;
    expect(snapshot).toMatchObject({
      type: "snapshot",
      protocol: PRESENCE_PROTOCOL,
    });
    if (snapshot.type !== "snapshot") throw new Error("not a snapshot");
    expect(snapshot.visitors.map((v) => v.p)).toContain("/acme/app");
    expect(snapshot.visitors[0]!.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("are pushed visitors arriving and changing page", async () => {
    const admin = await dashboard();
    const tab = await visit({ p: "/" });
    tab.send("p:/acme/app");
    await vi.waitFor(() =>
      expect(admin.messages.map((m) => m.type)).toContain("join"),
    );
    const join = admin.messages.find((m) => m.type === "join");
    expect(join?.type === "join" && join.visitor.p).toBe("/acme/app");
  });

  it("date a tab's going out of view back to when it went", async () => {
    const tab = await visit({ p: "/long-open" });
    const connected = Date.now() - 10 * 60_000;
    await rewrite(global(), (a) =>
      a.k === "visitor" ? { ...a, t: connected } : a,
    );
    const sent = Date.now();
    tab.send("v:0");
    // Never before the tab connected.
    const fresh = await visit({ p: "/just-opened" });
    fresh.send("v:0");
    await vi.waitFor(async () => {
      const tabs = await attachments(global(), "visitor");
      const old = tabs.find((a) => a.p === "/long-open");
      const young = tabs.find((a) => a.p === "/just-opened");
      expect(old?.v).toBe(0);
      expect(young?.v).toBe(0);
      expect(old?.h).toBeGreaterThanOrEqual(sent - HIDDEN_REPORT_MS);
      expect(old?.h).toBeLessThanOrEqual(Date.now() - HIDDEN_REPORT_MS);
      expect(young?.h).toBe(young?.t);
    });
  });

  it("keep a renewed token, and ignore a forged one", async () => {
    const admin = await dashboard(Date.now() + 20_000);
    const later = Date.now() + 45_000;
    admin.send(`t:${await token(later)}`);
    admin.send(`t:${await token(later + 10_000, "t".repeat(40))}`);
    await vi.waitFor(async () =>
      expect((await attachments(global(), "admin"))[0]?.x).toBe(later),
    );
  });

  it("are closed when their token runs out without being renewed", async () => {
    const admin = await dashboard();
    const code = closed(admin);
    await rewrite(global(), (a) =>
      a.k === "admin" ? { ...a, x: Date.now() - 1 } : a,
    );
    expect(await runDurableObjectAlarm(global())).toBe(true);
    expect(await code).toBe(4001);
  });

  it("sweep again no later than the soonest token runs out", async () => {
    const expires = Date.now() + 10_000;
    await dashboard(expires);
    const alarm = await runInDurableObject(global(), (_, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).toBe(expires);
  });

  it("are all closed when the operator signs out everywhere", async () => {
    const admin = await dashboard();
    const code = closed(admin);
    expect(
      (await postEvent(JSON.stringify({ kind: SIGNED_OUT_EVERYWHERE }))).status,
    ).toBe(200);
    expect(await code).toBe(4001);
  });
});

describe("events", () => {
  it("reach open dashboards, and list running jobs", async () => {
    const admin = await dashboard();
    await postEvent(
      JSON.stringify({
        kind: "video.start",
        repo: "acme/app",
        job: { id: "video:acme/app", state: "start", label: "acme/app" },
      }),
    );
    await vi.waitFor(() =>
      expect(admin.messages.map((m) => m.type)).toEqual(
        expect.arrayContaining(["event", "jobs"]),
      ),
    );
    const jobs = admin.messages.find((m) => m.type === "jobs");
    expect(jobs?.type === "jobs" && jobs.jobs.map((j) => j.id)).toEqual([
      "video:acme/app",
    ]);
  });

  it("refuse what is not an event object", async () => {
    for (const body of ["null", "[]", "3", '"x"', "{", "{}"])
      expect((await postEvent(body)).status).toBe(400);
  });

  it("refuse large bodies, counting bytes, before reading them", async () => {
    // 1,500 three-byte characters: short in UTF-16, 4,500 bytes.
    const wide = JSON.stringify({ kind: "x", note: "€".repeat(1_500) });
    expect(wide.length).toBeLessThan(4_000);
    expect((await postEvent(wide)).status).toBe(413);
    const declared = await postEvent(JSON.stringify({ kind: "x" }), {
      "content-length": "999999",
    }).catch(() => null);
    // Some runtimes refuse a false length themselves; if not, the worker does.
    if (declared) expect(declared.status).toBe(413);
  });
});

describe("visitor messages", () => {
  it("closes a socket that sends binary frames", async () => {
    const tab = await visit();
    const code = closed(tab);
    tab.send(new Uint8Array([1, 2, 3]));
    expect(await code).toBe(1003);
  });

  it("closes a socket that sends oversized frames", async () => {
    const tab = await visit();
    const code = closed(tab);
    tab.send(`p:/${"x".repeat(MAX_PATH + 5)}`);
    expect(await code).toBe(1009);
  });

  it("closes a socket that sends more changes than a person would", async () => {
    const tab = await visit();
    const code = closed(tab);
    for (let sent = 0; sent <= MAX_MESSAGES_PER_WINDOW; sent++)
      tab.send(`p:/page${sent}`);
    expect(await code).toBe(1008);
  });

  it("counts messages it does not understand", async () => {
    const tab = await visit();
    const code = closed(tab);
    for (let sent = 0; sent <= MAX_MESSAGES_PER_WINDOW; sent++)
      tab.send("hello");
    expect(await code).toBe(1008);
  });

  it("does not hold messages that change nothing against a person", async () => {
    const tab = await visit({ p: "/same" });
    for (let sent = 0; sent < MAX_MESSAGES_PER_WINDOW * 2; sent++)
      tab.send(sent % 2 ? "v:1" : "p:/same");
    tab.send("p:/other");
    await vi.waitFor(async () =>
      expect((await attachments(global(), "visitor"))[0]).toMatchObject({
        p: "/other",
        mc: 1,
        mf: MAX_MESSAGES_PER_WINDOW * 2 + 1,
      }),
    );
    expect(tab.readyState).toBe(WebSocket.OPEN);
  });
});

describe("sweeps", () => {
  it("keep a slow sweep going while only visitors are connected", async () => {
    await visit();
    const alarm = await runInDurableObject(global(), (_, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).not.toBeNull();
    expect(alarm! - Date.now()).toBeGreaterThan(60_000);
  });

  it("close visitors that went quiet", async () => {
    const tab = await visit();
    const code = closed(tab);
    await rewrite(global(), (a) => (a.k === "visitor" ? { ...a, t: 0 } : a));
    expect(await runDurableObjectAlarm(global())).toBe(true);
    expect(await code).toBe(1000);
  });
});

describe("a network's sockets", () => {
  const caps = () => env.PRESENCE.get(env.PRESENCE.idFromName("caps"));
  const open = async (ip: string) => {
    const response = await caps().fetch(`${BASE}/v?p=/`, {
      headers: { upgrade: "websocket", "cf-connecting-ip": ip },
    });
    if (response.webSocket) track(response.webSocket);
    return response.status;
  };

  it("are capped, but quiet ones make room instead of refusing", async () => {
    // One IPv6 subscriber's /64 counts as one network.
    for (let index = 0; index < 64; index++)
      expect(await open(`2001:db8:1:2::${(index + 1).toString(16)}`)).toBe(101);
    expect(await open("2001:db8:1:2:ffff::1")).toBe(429);
    // Another network is not affected.
    expect(await open("203.0.113.1")).toBe(101);

    await rewrite(caps(), (a) =>
      a.k === "visitor" && a.t ? { ...a, t: 0 } : a,
    );
    expect(await open("2001:db8:1:2:ffff::1")).toBe(101);
    const open2 = (await attachments(caps(), "visitor")).length;
    // The quiet ones were closed; the new one and the other network's remain.
    expect(open2).toBe(2);
  });
});
