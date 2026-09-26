import { DurableObject } from "cloudflare:workers";

import {
  isHere,
  normalizeVisitor,
  peopleHere,
} from "../../../src/features/admin/presence";
import {
  ADMIN_PROTOCOL,
  FEED_EVENTS,
  HIDDEN_REPORT_MS,
  MAX_PARKED_EVENT_AGE_MS,
  MAX_PATH,
  PRESENCE_PROTOCOL,
  SIGNED_OUT_EVERYWHERE,
  tokenFromProtocols,
} from "../../../src/features/admin/presence-protocol";
import type {
  LiveJob,
  LiveVisitor,
  PresenceMessage,
} from "../../../src/features/admin/types";
import { networkOf } from "../../../src/lib/network";
import {
  ADMIN_STALE_MS,
  adminTokenExpiry,
  clip,
  coordinate,
  countMessage,
  hostOf,
  isFresh,
  jobKey,
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
//
// Everything here runs on Cloudflare's free daily requests (the Worker and
// the object together), so nothing wakes it that need not: while no dashboard
// is open the site parks its events, and the object fetches them (a
// subrequest, which is free) when a dashboard connects and at every sweep.

export interface Env {
  PRESENCE: DurableObjectNamespace<Presence>;
  /** Shared with the site: signs dashboard tokens and authorizes events. */
  PRESENCE_SECRET: string;
  /** Comma-separated page origins allowed to open visitor sockets. */
  ALLOWED_ORIGINS: string;
  /** New visitor sockets per network per minute, checked before the object. */
  CONNECTS?: RateLimit;
  /** The site, whose /api/admin/presence-feed hands over parked events. */
  SITE_ORIGIN?: string;
}

type VisitorAttachment = { k: "visitor" } & LiveVisitor & {
    /** Message allowance: window start and counts (see countMessage). */
    mw?: number;
    mc?: number;
    mf?: number;
  };
/** A dashboard: when it connected, and when its token expires. */
type AdminAttachment = { k: "admin"; t?: number; x?: number };
type Attachment = VisitorAttachment | AdminAttachment;
type FeedEvent = Record<string, unknown> & { kind: string };

const isEvent = (value: unknown): value is FeedEvent =>
  Boolean(value) &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  typeof (value as { kind?: unknown }).kind === "string";

const MAX_EVENT_BYTES = 4_000;
// Sockets one network may hold, so a script cannot inflate the count cheaply.
// Generous, because a whole office or campus can share one address.
// Quiet sockets are closed first, so a network is never refused for tabs
// that are long gone.
const MAX_SOCKETS_PER_NETWORK = 64;
// How often quiet sockets are swept: often while a dashboard watches, rarely
// while only visitors are connected (so gone tabs still free their network's
// places), never while nobody is. Every sweep is a request Cloudflare counts.
const SWEEP_MS = 60_000;
const IDLE_SWEEP_MS = 15 * 60_000;
// A dashboard's messages are its renewed tokens.
const MAX_ADMIN_MESSAGE = 200;
// A job with no end event (its server died) drops off after this long. An
// end that arrives before its start is remembered as long, so the late start
// does not bring the job back.
const JOB_TTL_MS = 15 * 60_000;
const FLUSH_MS = 250;
// How long a dashboard waits on the site for parked events before the
// snapshot goes without them (the next sweep brings them).
const DRAIN_TIMEOUT_MS = 3_000;
// Set only by the Worker below; the object is not reachable any other way.
const EXPIRY_HEADER = "x-presence-admin-expiry";

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
    await this.drainSite();
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
    await this.scheduleSweep(now);
    // A browser that offered subprotocols fails the handshake unless one is
    // chosen.
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": ADMIN_PROTOCOL },
    });
  }

  private async acceptVisitor(request: Request, url: URL): Promise<Response> {
    const now = Date.now();
    const network = `net:${networkOf(clip(request.headers.get("cf-connecting-ip"), 64))}`;
    const sockets = this.ctx.getWebSockets(network);
    if (
      sockets.length >= MAX_SOCKETS_PER_NETWORK &&
      this.closeStale(sockets, now) >= MAX_SOCKETS_PER_NETWORK
    )
      return new Response("Too many connections", { status: 429 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    // 64 random bits: ids are how the dashboard tells tabs apart.
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
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
      t: now,
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
    await this.scheduleSweep(now);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const state = ws.deserializeAttachment() as Attachment | null;
    if (state?.k === "admin") {
      if (
        typeof message === "string" &&
        message.length <= MAX_ADMIN_MESSAGE &&
        message.startsWith("t:")
      )
        await this.renewAdmin(ws, state, message);
      return;
    }
    if (state?.k !== "visitor") return;

    // Every message is counted before anything else, so none can keep
    // waking the object for free; ones that change nothing are not held
    // against the tab's allowance of changes (see countMessage).
    const now = Date.now();
    const text =
      typeof message === "string" && message.length <= MAX_PATH + 2
        ? message
        : null;
    const next: VisitorAttachment = { ...state };
    let understood = false;
    let update: Extract<PresenceMessage, { type: "update" }> | null = null;
    if (text?.startsWith("p:")) {
      understood = true;
      const p = text.slice(2) || "/";
      if (p !== state.p) {
        next.p = p;
        update = { type: "update", id: state.id, p };
      }
    } else if (text === "v:0" || text === "v:1") {
      understood = true;
      const v = text === "v:1" ? 1 : 0;
      if (v !== state.v) {
        // A tab says it is hidden HIDDEN_REPORT_MS after it went.
        const h = v ? 0 : Math.max(state.t, now - HIDDEN_REPORT_MS);
        next.v = v;
        next.h = h;
        update = { type: "update", id: state.id, v, h };
      }
    }
    const allowance = countMessage(state, now, !understood || update !== null);
    if (!allowance.allowed) {
      this.drop(ws, 1008, "Too many messages");
      return;
    }
    if (typeof message !== "string") {
      this.drop(ws, 1003, "Text only");
      return;
    }
    if (text === null) {
      this.drop(ws, 1009, "Too long");
      return;
    }
    next.mw = allowance.mw;
    next.mc = allowance.mc;
    next.mf = allowance.mf;
    ws.serializeAttachment(next);
    // Only someone who was not already counted can raise the peak.
    if (update?.v === 1 && !isHere(state, now)) this.peakDirty = true;
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
   * Every minute while a dashboard is open (and as a dashboard's token runs
   * out), every 15 minutes while only visitors are connected: close sockets
   * that went quiet (visitors and dashboards), close dashboards whose token
   * ran out, forget orphaned jobs, and start a new day's peak at midnight
   * UTC. Counts and peaks only ever use live sockets, so the slow sweep is
   * there to give a network back the places its vanished tabs held.
   */
  async alarm() {
    if (this.admins().length) await this.drainSite();
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
    await this.scheduleSweep(now);
  }

  /** Sets the next sweep (see alarm), unless one is due sooner. */
  private async scheduleSweep(now: number) {
    let at: number | null = null;
    const admins = this.admins().filter(
      (ws) => ws.readyState === WebSocket.OPEN,
    );
    if (admins.length) {
      at = now + SWEEP_MS;
      for (const ws of admins) {
        const state = ws.deserializeAttachment() as AdminAttachment | null;
        if (state?.x && state.x < at) at = Math.max(state.x, now + 1_000);
      }
    } else if (this.ctx.getWebSockets("visitor").length) {
      at = now + IDLE_SWEEP_MS;
    }
    if (at === null) return;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at) await this.ctx.storage.setAlarm(at);
  }

  /**
   * Closes the quiet visitor sockets among `sockets`, and says how many are
   * left. Their pings are answered without waking the object, so this is
   * how a network whose tabs vanished (a laptop that slept) gets its places
   * back as soon as it needs them.
   */
  private closeStale(sockets: WebSocket[], now: number): number {
    let left = 0;
    for (const ws of sockets) {
      const state = ws.deserializeAttachment() as Attachment | null;
      if (state?.k === "visitor" && !this.isLive(ws, state.t, STALE_MS, now))
        this.drop(ws);
      else left += 1;
    }
    return left;
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

  /**
   * Tells the site a dashboard is watching (so it sends events straight
   * here for a while) and takes the events it parked while none was.
   */
  private async drainSite() {
    const origin = this.env.SITE_ORIGIN?.replace(/\/$/, "");
    const secret = this.env.PRESENCE_SECRET ?? "";
    if (!origin || secret.length < 32) return;
    let events: unknown;
    try {
      const response = await fetch(`${origin}/api/admin/presence-feed`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(DRAIN_TIMEOUT_MS),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return;
      }
      ({ events } = (await response.json()) as { events?: unknown });
    } catch {
      return; // The next sweep tries again.
    }
    if (!Array.isArray(events)) return;
    for (const event of events.slice(-FEED_EVENTS))
      if (isEvent(event)) await this.ingest(event, Date.now());
  }

  private async receiveEvent(request: Request): Promise<Response> {
    const tooLarge = () => new Response("Too large", { status: 413 });
    if (Number(request.headers.get("content-length")) > MAX_EVENT_BYTES)
      return tooLarge();
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_EVENT_BYTES) return tooLarge();
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return new Response("Not an event", { status: 400 });
    if (!isEvent(parsed)) return new Response("Missing kind", { status: 400 });
    await this.ingest(parsed, Date.now());
    return Response.json({ ok: true });
  }

  /**
   * Keeps an event for the feed, tracks its job, and pushes it to open
   * dashboards. It keeps the time the site gave it (an event may have waited
   * in Redis), unless that is in the future or too old to trust.
   */
  private async ingest(event: FeedEvent, now: number) {
    const stamped = typeof event.at === "number" ? event.at : NaN;
    const at =
      stamped >= now - MAX_PARKED_EVENT_AGE_MS ? Math.min(stamped, now) : now;
    event.at = at;

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
            started: at,
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
        sql.exec("INSERT OR REPLACE INTO ended (id, at) VALUES (?, ?)", id, at);
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
    // Every dashboard's session just ended. 4001 makes a dashboard ask the
    // site for a new token, which a signed-out browser no longer gets; the
    // tokens' short life is the backstop if this event is lost.
    if (event.kind === SIGNED_OUT_EVERYWHERE)
      for (const ws of this.admins()) this.drop(ws, 4001, "Signed out");
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
        const { k: _, mw: __, mc: ___, mf: ____, ...visitor } = state;
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
      this.scheduleFlush();
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
      protocol: PRESENCE_PROTOCOL,
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

  /** In a moment: record a possible new peak, and push what is waiting. */
  private scheduleFlush() {
    if (this.flushTimer !== null) return;
    if (!this.peakDirty && !this.admins().length) return;
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  /** Record a new peak if one may have happened, then push what is waiting. */
  private flush() {
    if (this.peakDirty) {
      this.peakDirty = false;
      this.recordPeak(Date.now());
    }
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
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
      // Dashboards send the token as a WebSocket subprotocol, so it stays out
      // of request logs.
      const token = tokenFromProtocols(
        request.headers.get("sec-websocket-protocol"),
      );
      const expires = token
        ? await adminTokenExpiry(token, secret, Date.now())
        : null;
      if (expires === null) return new Response("Forbidden", { status: 403 });
      const forwarded = new URL(request.url);
      forwarded.search = "";
      const headers = new Headers(request.headers);
      headers.set(EXPIRY_HEADER, String(expires));
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
