import { DurableObject } from "cloudflare:workers";

import {
  isHere,
  normalizeVisitor,
  peopleHere,
} from "../../../src/features/admin/presence";
import {
  ADMIN_PROTOCOL,
  FEED_EVENTS,
  tokenFromProtocols,
} from "../../../src/features/admin/presence-protocol";
import type {
  LiveJob,
  LiveVisitor,
  PresenceMessage,
} from "../../../src/features/admin/types";
import {
  ADMIN_STALE_MS,
  adminTokenExpiry,
  clip,
  coordinate,
  countMessage,
  hostOf,
  isFresh,
  jobKey,
  MAX_PATH,
  networkOf,
  Outbox,
  type Peak,
  rollPeak,
  sameText,
  STALE_MS,
  utcDay,
} from "./logic";

// Live presence for gitdiagram.com, and the operator's event feed.
//
// Every open GitDiagram tab holds one WebSocket to a single Durable Object, so
// "who is on the site" is the set of open sockets: exact, and it changes the
// moment a tab opens or closes. Sockets use the hibernation API, so an idle
// connection costs nothing while it waits, and keep-alive pings are answered
// by the runtime without waking the object. The operator's dashboard
// (/admin on the site) holds one more socket and is pushed every change,
// batched a quarter of a second at a time. The site's server also posts
// generation events here, which the dashboard shows as a live feed.
//
// The object keeps a copy of every tab in memory while awake (rebuilt from
// the sockets' attachments after it hibernates), so a tab's message costs one
// attachment read and write, not a pass over every socket.

export interface Env {
  PRESENCE: DurableObjectNamespace<Presence>;
  /** Shared with the site: signs dashboard tokens and authorizes events. */
  PRESENCE_SECRET: string;
  /** Comma-separated page origins allowed to open visitor sockets. */
  ALLOWED_ORIGINS: string;
  /** New visitor sockets per network per minute, checked before the object. */
  CONNECTS?: RateLimit;
}

type VisitorAttachment = { k: "visitor" } & LiveVisitor & {
    /** Message allowance: window start and count (see countMessage). */
    mw?: number;
    mc?: number;
  };
/** A dashboard: when it connected, and when its token expires. */
type AdminAttachment = { k: "admin"; t?: number; x?: number };
type Attachment = VisitorAttachment | AdminAttachment;

const MAX_EVENT_BYTES = 4_000;
// Sockets one network may hold, so a script cannot inflate the count cheaply.
// Generous, because a whole office or campus can share one address.
const MAX_SOCKETS_PER_NETWORK = 64;
const SWEEP_MS = 30_000;
// A job with no end event (its server died) drops off after this long. An
// end that arrives before its start is remembered as long, so the late start
// does not bring the job back.
const JOB_TTL_MS = 15 * 60_000;
const FLUSH_MS = 250;
// Set only by the Worker below; the object is not reachable any other way.
const EXPIRY_HEADER = "x-presence-admin-expiry";
const PROTOCOL_HEADER = "x-presence-admin-protocol";

export class Presence extends DurableObject<Env> {
  private roster: Map<string, { ws: WebSocket; visitor: LiveVisitor }> | null =
    null;
  private outbox = new Outbox();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private peakDirty = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL, started INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS ended (id TEXT PRIMARY KEY, at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      `);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/event") return this.receiveEvent(request);
    if (url.pathname === "/admin") return this.acceptAdmin(request);
    return this.acceptVisitor(request, url);
  }

  private async acceptAdmin(request: Request): Promise<Response> {
    const now = Date.now();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, ["admin"]);
    server.serializeAttachment({
      k: "admin",
      t: now,
      x: Number(request.headers.get(EXPIRY_HEADER)) || undefined,
    } satisfies AdminAttachment);
    server.send(JSON.stringify(this.snapshot(now)));
    await this.scheduleSweep();
    // A browser that offered subprotocols fails the handshake unless one is
    // chosen; dashboards that sent the token in the URL offered none.
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers:
        request.headers.get(PROTOCOL_HEADER) === "1"
          ? { "Sec-WebSocket-Protocol": ADMIN_PROTOCOL }
          : undefined,
    });
  }

  private acceptVisitor(request: Request, url: URL): Response {
    const network = `net:${networkOf(clip(request.headers.get("cf-connecting-ip"), 64))}`;
    if (this.ctx.getWebSockets(network).length >= MAX_SOCKETS_PER_NETWORK)
      return new Response("Too many connections", { status: 429 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const id = crypto.randomUUID().slice(0, 8);
    const browser = url.searchParams.get("b") ?? "";
    const visible = url.searchParams.get("v") !== "0";
    const visitor: LiveVisitor = {
      id,
      b: /^[a-z0-9]{8,24}$/.test(browser) ? browser : id,
      p: clip(url.searchParams.get("p"), MAX_PATH) || "/",
      v: visible ? 1 : 0,
      h: 0,
      z: clip(url.searchParams.get("z"), 40),
      iz: clip(url.searchParams.get("gz"), 40),
      d: url.searchParams.get("d") === "m" ? "m" : "d",
      c: clip(url.searchParams.get("gc"), 2),
      r: clip(url.searchParams.get("gr"), 8),
      ct: clip(url.searchParams.get("gt"), 60),
      la: coordinate(url.searchParams.get("gla"), 90),
      lo: coordinate(url.searchParams.get("glo"), 180),
      ref: clip(url.searchParams.get("r"), 100),
      t: Date.now(),
    };
    this.ctx.acceptWebSocket(server, ["visitor", network]);
    server.serializeAttachment({
      k: "visitor",
      ...visitor,
    } satisfies VisitorAttachment);
    this.roster?.set(id, { ws: server, visitor });
    this.queue({ type: "join", visitor });
    if (visible) this.peakDirty = true;
    this.scheduleFlush();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string" || message.length > MAX_PATH + 2) return;
    const state = ws.deserializeAttachment() as Attachment | null;
    if (state?.k === "admin") {
      if (message.startsWith("t:")) await this.renewAdmin(ws, state, message);
      return;
    }
    if (state?.k !== "visitor") return;

    const now = Date.now();
    const allowance = countMessage(state, now);
    if (!allowance.allowed) {
      this.drop(ws, 1008, "Too many messages");
      return;
    }
    const next: VisitorAttachment = {
      ...state,
      mw: allowance.mw,
      mc: allowance.mc,
    };
    let update: Extract<PresenceMessage, { type: "update" }> | null = null;
    if (message.startsWith("p:")) {
      const p = message.slice(2) || "/";
      if (p !== state.p) {
        next.p = p;
        update = { type: "update", id: state.id, p };
      }
    } else if (message === "v:0" || message === "v:1") {
      const v = message === "v:1" ? 1 : 0;
      if (v !== state.v) {
        const h = v ? 0 : now;
        next.v = v;
        next.h = h;
        update = { type: "update", id: state.id, v, h };
        // Only someone who was not already counted can raise the peak.
        if (v && !isHere(state, now)) this.peakDirty = true;
      }
    }
    ws.serializeAttachment(next);
    if (!update) return;
    const entry = this.roster?.get(state.id);
    if (entry)
      entry.visitor = { ...entry.visitor, p: next.p, v: next.v, h: next.h };
    this.queue(update);
    this.scheduleFlush();
  }

  async webSocketClose(ws: WebSocket) {
    this.drop(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.drop(ws);
  }

  /**
   * While a dashboard is open, every 30 s: close sockets that went quiet
   * (visitors and dashboards), close dashboards whose token ran out, forget
   * orphaned jobs, and start a new day's peak at midnight UTC. Nothing needs
   * this while nobody watches: counts and peaks only ever use live sockets.
   */
  async alarm() {
    const now = Date.now();
    for (const { ws, visitor } of this.getRoster().values())
      if (!this.isLive(ws, visitor.t, STALE_MS, now)) this.drop(ws);
    for (const ws of this.admins()) {
      const state = ws.deserializeAttachment() as AdminAttachment | null;
      if (state?.x && state.x <= now) this.drop(ws, 4001, "Token expired");
      else if (!this.isLive(ws, state?.t ?? 0, ADMIN_STALE_MS, now))
        this.drop(ws, 1001, "Gone quiet");
    }
    const sql = this.ctx.storage.sql;
    const removed = sql
      .exec("DELETE FROM jobs WHERE started < ? RETURNING id", now - JOB_TTL_MS)
      .toArray();
    if (removed.length) this.queue({ type: "jobs", jobs: this.jobs(now) });
    sql.exec("DELETE FROM ended WHERE at < ?", now - JOB_TTL_MS);
    this.recordPeak(now);
    this.flush();
    await this.scheduleSweep();
  }

  private async scheduleSweep() {
    if (!this.admins().length) return;
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }

  /** A dashboard sends its newer token as it gets one, to stay connected. */
  private async renewAdmin(
    ws: WebSocket,
    state: AdminAttachment,
    message: string,
  ) {
    const expires = await adminTokenExpiry(
      message.slice(2),
      this.env.PRESENCE_SECRET ?? "",
      Date.now(),
    );
    if (expires && expires > (state.x ?? 0))
      ws.serializeAttachment({
        ...state,
        x: expires,
      } satisfies AdminAttachment);
  }

  private isLive(
    ws: WebSocket,
    connectedAt: number,
    staleMs: number,
    now: number,
  ): boolean {
    const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws);
    return isFresh(connectedAt, lastPing?.getTime() ?? null, now, staleMs);
  }

  private drop(ws: WebSocket, code = 1000, reason = "bye") {
    const state = ws.deserializeAttachment() as Attachment | null;
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
    if (state?.k !== "visitor") return;
    if (this.roster && !this.roster.delete(state.id)) return;
    this.queue({ type: "leave", id: state.id });
    this.scheduleFlush();
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
    const now = Date.now();
    event.at = now;

    const sql = this.ctx.storage.sql;
    const job = event.job as
      { id?: unknown; state?: unknown; label?: unknown } | undefined;
    let jobsChanged = false;
    if (job && typeof job.id === "string") {
      const id = await jobKey(job.id);
      if (job.state === "start") {
        const ended = sql
          .exec(
            "SELECT 1 FROM ended WHERE id = ? AND at >= ?",
            id,
            now - JOB_TTL_MS,
          )
          .toArray().length;
        if (!ended) {
          const body: LiveJob = {
            id,
            kind: event.kind.split(".")[0] ?? event.kind,
            label: typeof job.label === "string" ? job.label.slice(0, 200) : "",
            started: now,
          };
          sql.exec(
            "INSERT OR REPLACE INTO jobs (id, body, started) VALUES (?, ?, ?)",
            body.id,
            JSON.stringify(body),
            body.started,
          );
          jobsChanged = true;
        }
      } else {
        sql.exec("DELETE FROM jobs WHERE id = ?", id);
        sql.exec(
          "INSERT OR REPLACE INTO ended (id, at) VALUES (?, ?)",
          id,
          now,
        );
        sql.exec("DELETE FROM ended WHERE at < ?", now - JOB_TTL_MS);
        jobsChanged = true;
      }
    }
    const { id } = sql
      .exec<{ id: number }>(
        "INSERT INTO events (body) VALUES (?) RETURNING id",
        JSON.stringify(event),
      )
      .one();
    sql.exec("DELETE FROM events WHERE id <= ?", id - FEED_EVENTS);
    event.id = id;

    this.queue({
      type: "event",
      event: event as Extract<PresenceMessage, { type: "event" }>["event"],
    });
    if (jobsChanged) this.queue({ type: "jobs", jobs: this.jobs(now) });
    this.scheduleFlush();
    return Response.json({ ok: true });
  }

  private admins() {
    return this.ctx.getWebSockets("admin");
  }

  /** Every open tab, from memory; read from the sockets once per wake-up. */
  private getRoster() {
    if (!this.roster) {
      this.roster = new Map();
      for (const ws of this.ctx.getWebSockets("visitor")) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        const state = ws.deserializeAttachment() as Attachment | null;
        if (state?.k !== "visitor") continue;
        const { k: _, mw: __, mc: ___, ...visitor } = state;
        this.roster.set(state.id, { ws, visitor: normalizeVisitor(visitor) });
      }
    }
    return this.roster;
  }

  /** Open tabs whose connection is still alive. */
  private visitors(now: number): LiveVisitor[] {
    const list: LiveVisitor[] = [];
    for (const { ws, visitor } of this.getRoster().values())
      if (this.isLive(ws, visitor.t, STALE_MS, now)) list.push(visitor);
    return list;
  }

  private jobs(now: number): LiveJob[] {
    return this.ctx.storage.sql
      .exec<{ body: string }>(
        "SELECT body FROM jobs WHERE started >= ? ORDER BY started",
        now - JOB_TTL_MS,
      )
      .toArray()
      .map((row) => JSON.parse(row.body) as LiveJob);
  }

  /** Today's peak of people here, raised (or started afresh) as needed. */
  private recordPeak(now: number): Peak {
    const row = this.ctx.storage.sql
      .exec<{ v: string }>("SELECT v FROM kv WHERE k = 'peak-here'")
      .toArray()[0];
    const stored = row ? (JSON.parse(row.v) as Peak) : null;
    const { peak, changed } = rollPeak(
      stored,
      utcDay(now),
      peopleHere(this.visitors(now), now).length,
      now,
    );
    if (changed) {
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO kv (k, v) VALUES ('peak-here', ?)",
        JSON.stringify(peak),
      );
      this.queue({ type: "peak", peak });
    }
    return peak;
  }

  private snapshot(now: number): PresenceMessage {
    const events = this.ctx.storage.sql
      .exec<{ id: number; body: string }>(
        "SELECT id, body FROM events ORDER BY id DESC LIMIT ?",
        FEED_EVENTS,
      )
      .toArray()
      .map((row) => ({ ...(JSON.parse(row.body) as object), id: row.id }));
    return {
      type: "snapshot",
      now,
      visitors: this.visitors(now),
      events: events as Extract<
        PresenceMessage,
        { type: "snapshot" }
      >["events"],
      jobs: this.jobs(now),
      peak: this.recordPeak(now),
    };
  }

  /** Hold a change for open dashboards; nothing to do when none is open. */
  private queue(message: PresenceMessage) {
    if (this.admins().length) this.outbox.push(message);
  }

  private scheduleFlush() {
    if (this.flushTimer === null)
      this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  /** Record a new peak if one may have happened, then push what is waiting. */
  private flush() {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.peakDirty) {
      this.peakDirty = false;
      this.recordPeak(Date.now());
    }
    const messages = this.outbox.drain();
    const admins = this.admins();
    if (!messages.length || !admins.length) return;
    for (const message of messages) {
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
      // Stops other sites' pages; scripts can send any Origin, which is what
      // the per-network limits below and in the object are for.
      const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
      if (!allowed.includes(request.headers.get("origin") ?? ""))
        return new Response("Forbidden", { status: 403 });
      const network = networkOf(request.headers.get("cf-connecting-ip") ?? "");
      if (env.CONNECTS && !(await env.CONNECTS.limit({ key: network })).success)
        return new Response("Too many connections", { status: 429 });
      // Keep only the referrer's host, and pass on the visitor's coarse
      // location (the object's own request loses Cloudflare's geolocation).
      const cf = request.cf as
        | {
            country?: string;
            regionCode?: string;
            city?: string;
            timezone?: string;
            latitude?: string;
            longitude?: string;
          }
        | undefined;
      const forwarded = new URL(request.url);
      forwarded.searchParams.set("r", hostOf(url.searchParams.get("r")));
      forwarded.searchParams.set("gc", cf?.country ?? "");
      forwarded.searchParams.set("gr", cf?.regionCode ?? "");
      forwarded.searchParams.set("gt", cf?.city ?? "");
      forwarded.searchParams.set("gz", cf?.timezone ?? "");
      forwarded.searchParams.set("gla", cf?.latitude ?? "");
      forwarded.searchParams.set("glo", cf?.longitude ?? "");
      return stub().fetch(new Request(forwarded, request));
    }

    if (url.pathname === "/admin" && upgrade) {
      // New dashboards send the token as a WebSocket subprotocol, so it stays
      // out of request logs; dashboards from before that send it as ?t=.
      const offered = tokenFromProtocols(
        request.headers.get("sec-websocket-protocol"),
      );
      const token = offered ?? url.searchParams.get("t") ?? "";
      const expires = await adminTokenExpiry(token, secret, Date.now());
      if (expires === null) return new Response("Forbidden", { status: 403 });
      const forwarded = new URL(request.url);
      forwarded.search = "";
      const headers = new Headers(request.headers);
      headers.set(EXPIRY_HEADER, String(expires));
      if (offered) headers.set(PROTOCOL_HEADER, "1");
      else headers.delete(PROTOCOL_HEADER);
      return stub().fetch(new Request(forwarded, { method: "GET", headers }));
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
