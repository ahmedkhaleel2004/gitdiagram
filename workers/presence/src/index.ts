import { DurableObject } from "cloudflare:workers";

// Live presence for gitdiagram.com, and the operator's event feed.
//
// Every open GitDiagram tab holds one WebSocket to a single Durable Object, so
// "who is on the site" is the set of open sockets: exact, and it changes the
// moment a tab opens or closes. Sockets use the hibernation API, so an idle
// connection costs nothing while it waits, and keep-alive pings are answered
// by the runtime without waking the object. The operator's dashboard
// (/admin on the site) holds one more socket and is pushed every change as it
// happens. The site's server also posts generation events here, which the
// dashboard shows as a live feed.

export interface Env {
  PRESENCE: DurableObjectNamespace<Presence>;
  /** Shared with the site: signs dashboard tokens and authorizes events. */
  PRESENCE_SECRET: string;
  /** Comma-separated page origins allowed to open visitor sockets. */
  ALLOWED_ORIGINS: string;
}

interface Visitor {
  id: string;
  /**
   * The browser: one id shared by all of a person's tabs, so the dashboard
   * can count people, not tabs. Older tabs without one count on their own.
   */
  b: string;
  /** Current path. */
  p: string;
  /** Tab visible (1) or in the background (0). */
  v: 0 | 1;
  /** When the tab went to the background (ms), or 0 while it is in view. */
  h: number;
  /** Device: desktop or mobile. */
  d: "d" | "m";
  /** Country, region and city from Cloudflare's IP geolocation. */
  c: string;
  r: string;
  ct: string;
  /** Referring site, host only. */
  ref: string;
  /** Connected at (ms). */
  t: number;
}

type Attachment = ({ k: "visitor" } & Visitor) | { k: "admin" };

interface Job {
  id: string;
  kind: string;
  label: string;
  started: number;
}

const MAX_PATH = 300;
const MAX_EVENT_BYTES = 4_000;
const KEPT_EVENTS = 300;
// Sockets one network may hold, so a script cannot inflate the count cheaply.
// Generous, because a whole office or campus can share one address.
const MAX_SOCKETS_PER_NETWORK = 64;
// Someone who looked at a tab this recently still counts as here: they may
// have switched to their editor while a diagram generates.
const RECENT_MS = 120_000;
// Tabs ping every 30 s (throttled to about once a minute in the background).
// A socket silent for longer than this lost its network without closing.
const STALE_MS = 150_000;
const SWEEP_MS = 30_000;
// A job with no end event (its server died) drops off after this long.
const JOB_TTL_MS = 15 * 60_000;

const clip = (value: string | null | undefined, max: number) =>
  (value ?? "").slice(0, max);

function hostOf(value: string | null): string {
  if (!value) return "";
  try {
    return new URL(value).host.slice(0, 100);
  } catch {
    return "";
  }
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class Presence extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL, started INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      `);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/event") return this.receiveEvent(request);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    if (url.pathname === "/admin") {
      this.ctx.acceptWebSocket(server, ["admin"]);
      server.serializeAttachment({ k: "admin" } satisfies Attachment);
      server.send(JSON.stringify(this.snapshot()));
      await this.scheduleSweep();
      return new Response(null, { status: 101, webSocket: client });
    }

    const network = `net:${clip(request.headers.get("cf-connecting-ip"), 64)}`;
    if (this.ctx.getWebSockets(network).length >= MAX_SOCKETS_PER_NETWORK)
      return new Response("Too many connections", { status: 429 });

    const id = crypto.randomUUID().slice(0, 8);
    const browser = url.searchParams.get("b") ?? "";
    const visible = url.searchParams.get("v") !== "0";
    const visitor: Visitor = {
      id,
      b: /^[a-z0-9]{8,24}$/.test(browser) ? browser : id,
      p: clip(url.searchParams.get("p"), MAX_PATH) || "/",
      v: visible ? 1 : 0,
      h: visible ? 0 : Date.now(),
      d: url.searchParams.get("d") === "m" ? "m" : "d",
      c: clip(url.searchParams.get("gc"), 2),
      r: clip(url.searchParams.get("gr"), 8),
      ct: clip(url.searchParams.get("gt"), 60),
      ref: clip(url.searchParams.get("r"), 100),
      t: Date.now(),
    };
    this.ctx.acceptWebSocket(server, ["visitor", network]);
    server.serializeAttachment({
      k: "visitor",
      ...visitor,
    } satisfies Attachment);
    this.broadcast({ type: "join", visitor });
    this.recordPeak();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string" || message.length > MAX_PATH + 2) return;
    const state = ws.deserializeAttachment() as Attachment | null;
    if (state?.k === "admin") {
      if (message === "sync") ws.send(JSON.stringify(this.snapshot()));
      return;
    }
    if (state?.k !== "visitor") return;
    if (message.startsWith("p:")) {
      const p = message.slice(2) || "/";
      if (p === state.p) return;
      ws.serializeAttachment({ ...state, p });
      this.broadcast({ type: "update", id: state.id, p });
    } else if (message === "v:0" || message === "v:1") {
      const v = message === "v:1" ? 1 : 0;
      if (v === state.v) return;
      const h = v ? 0 : Date.now();
      ws.serializeAttachment({ ...state, v, h });
      this.broadcast({ type: "update", id: state.id, v, h });
      if (v) this.recordPeak();
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.drop(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.drop(ws);
  }

  /** Close stale visitor sockets and forget orphaned jobs while watched. */
  async alarm() {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets("visitor")) {
      const state = ws.deserializeAttachment() as Attachment | null;
      if (state?.k !== "visitor" || now - state.t < STALE_MS) continue;
      const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws);
      if (!lastPing || now - lastPing.getTime() > STALE_MS) this.drop(ws);
    }
    const removed = this.ctx.storage.sql
      .exec("DELETE FROM jobs WHERE started < ? RETURNING id", now - JOB_TTL_MS)
      .toArray();
    if (removed.length) this.broadcast({ type: "jobs", jobs: this.jobs() });
    await this.scheduleSweep();
  }

  private async scheduleSweep() {
    if (!this.admins().length) return;
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }

  private drop(ws: WebSocket) {
    const state = ws.deserializeAttachment() as Attachment | null;
    try {
      ws.close(1000, "bye");
    } catch {
      // Already closed.
    }
    if (state?.k === "visitor") this.broadcast({ type: "leave", id: state.id });
  }

  private async receiveEvent(request: Request): Promise<Response> {
    const text = await request.text();
    if (text.length > MAX_EVENT_BYTES)
      return new Response("Too large", { status: 413 });
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }
    if (typeof event.kind !== "string")
      return new Response("Missing kind", { status: 400 });
    event.at = Date.now();

    const sql = this.ctx.storage.sql;
    const job = event.job as
      { id?: unknown; state?: unknown; label?: unknown } | undefined;
    let jobsChanged = false;
    if (job && typeof job.id === "string") {
      if (job.state === "start") {
        const body: Job = {
          id: job.id.slice(0, 120),
          kind: event.kind.split(".")[0] ?? event.kind,
          label: typeof job.label === "string" ? job.label.slice(0, 200) : "",
          started: Date.now(),
        };
        sql.exec(
          "INSERT OR REPLACE INTO jobs (id, body, started) VALUES (?, ?, ?)",
          body.id,
          JSON.stringify(body),
          body.started,
        );
      } else {
        sql.exec("DELETE FROM jobs WHERE id = ?", job.id.slice(0, 120));
      }
      jobsChanged = true;
    }
    const { id } = sql
      .exec<{ id: number }>(
        "INSERT INTO events (body) VALUES (?) RETURNING id",
        JSON.stringify(event),
      )
      .one();
    sql.exec("DELETE FROM events WHERE id <= ?", id - KEPT_EVENTS);
    event.id = id;

    this.broadcast({ type: "event", event });
    if (jobsChanged) this.broadcast({ type: "jobs", jobs: this.jobs() });
    return Response.json({ ok: true });
  }

  private admins() {
    return this.ctx.getWebSockets("admin");
  }

  private visitors(): Visitor[] {
    const list: Visitor[] = [];
    for (const ws of this.ctx.getWebSockets("visitor")) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const state = ws.deserializeAttachment() as Attachment | null;
      if (state?.k !== "visitor") continue;
      const { k: _, ...visitor } = state;
      // Tabs that connected before browser ids and hidden times existed.
      list.push({ ...visitor, b: visitor.b || visitor.id, h: visitor.h ?? 0 });
    }
    return list;
  }

  private jobs(): Job[] {
    return this.ctx.storage.sql
      .exec<{ body: string }>("SELECT body FROM jobs ORDER BY started")
      .toArray()
      .map((row) => JSON.parse(row.body) as Job);
  }

  private peak(): { day: string; count: number; at: number } {
    const row = this.ctx.storage.sql
      .exec<{ v: string }>("SELECT v FROM kv WHERE k = 'peak-people'")
      .toArray()[0];
    const today = utcDay(Date.now());
    const peak = row
      ? (JSON.parse(row.v) as { day: string; count: number; at: number })
      : null;
    return peak?.day === today ? peak : { day: today, count: 0, at: 0 };
  }

  /** People here now: browsers with a tab in view or looked at very recently. */
  private peopleHere(): number {
    const now = Date.now();
    const here = new Set<string>();
    for (const visitor of this.visitors())
      if (visitor.v === 1 || now - visitor.h < RECENT_MS) here.add(visitor.b);
    return here.size;
  }

  private recordPeak() {
    const count = this.peopleHere();
    const peak = this.peak();
    if (count <= peak.count) return;
    const next = { day: peak.day, count, at: Date.now() };
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO kv (k, v) VALUES ('peak-people', ?)",
      JSON.stringify(next),
    );
    this.broadcast({ type: "peak", peak: next });
  }

  private snapshot() {
    const events = this.ctx.storage.sql
      .exec<{ id: number; body: string }>(
        "SELECT id, body FROM events ORDER BY id DESC LIMIT 150",
      )
      .toArray()
      .map((row) => ({ ...(JSON.parse(row.body) as object), id: row.id }));
    return {
      type: "snapshot",
      now: Date.now(),
      visitors: this.visitors(),
      events,
      jobs: this.jobs(),
      peak: this.peak(),
    };
  }

  /** Push a change to every open dashboard; nothing to do when none is open. */
  private broadcast(message: object) {
    const admins = this.admins();
    if (!admins.length) return;
    const text = JSON.stringify(message);
    for (const ws of admins) {
      try {
        ws.send(text);
      } catch {
        // A closing dashboard; its close handler cleans up.
      }
    }
  }
}

async function hmacHex(secret: string, message: string): Promise<string> {
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
    new TextEncoder().encode(message),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sameText(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  return (
    left.byteLength === right.byteLength &&
    crypto.subtle.timingSafeEqual(left, right)
  );
}

/** Dashboard tokens are `<expiry ms>.<hmac>`, minted by the site for an hour at most. */
async function isAdminToken(token: string, secret: string): Promise<boolean> {
  const [expiry, signature] = token.split(".");
  const expires = Number(expiry);
  if (!signature || !Number.isFinite(expires)) return false;
  const now = Date.now();
  if (expires < now || expires > now + 3_600_000) return false;
  return sameText(signature, await hmacHex(secret, `presence-admin:${expiry}`));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const secret = env.PRESENCE_SECRET ?? "";
    if (url.pathname === "/") return new Response("ok");
    const upgrade =
      request.headers.get("upgrade")?.toLowerCase() === "websocket";
    const stub = () =>
      env.PRESENCE.get(env.PRESENCE.idFromName("global"), {
        locationHint: "enam",
      });

    if (url.pathname === "/v" && upgrade) {
      const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
      if (!allowed.includes(request.headers.get("origin") ?? ""))
        return new Response("Forbidden", { status: 403 });
      // Keep only the referrer's host, and pass on the visitor's coarse
      // location (the object's own request loses Cloudflare's geolocation).
      const cf = request.cf as
        { country?: string; regionCode?: string; city?: string } | undefined;
      const forwarded = new URL(request.url);
      forwarded.searchParams.set("r", hostOf(url.searchParams.get("r")));
      forwarded.searchParams.set("gc", cf?.country ?? "");
      forwarded.searchParams.set("gr", cf?.regionCode ?? "");
      forwarded.searchParams.set("gt", cf?.city ?? "");
      return stub().fetch(new Request(forwarded, request));
    }

    if (url.pathname === "/admin" && upgrade) {
      if (
        secret.length < 32 ||
        !(await isAdminToken(url.searchParams.get("t") ?? "", secret))
      )
        return new Response("Forbidden", { status: 403 });
      return stub().fetch(request);
    }

    if (url.pathname === "/event" && request.method === "POST") {
      const presented = request.headers.get("authorization") ?? "";
      if (secret.length < 32 || !sameText(presented, `Bearer ${secret}`))
        return new Response("Forbidden", { status: 403 });
      return stub().fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
