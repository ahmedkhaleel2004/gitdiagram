# gitdiagram-presence

The Cloudflare Worker behind gitdiagram.com/admin: live presence (one hibernating
WebSocket per open tab, held by a single Durable Object) and the operator's live
event feed. See the "Operator dashboard" section of the repo's `CLAUDE.md`.

```bash
bun install
cp .dev.vars.example .dev.vars   # add PRESENCE_SECRET="<32+ chars>"
bun run dev                      # ws://localhost:8787
bun run typecheck
bun run test                     # in the Workers runtime (@cloudflare/vitest-plugin)
bunx wrangler deploy             # production
bunx wrangler secret put PRESENCE_SECRET
```

The tests run the Worker and its Durable Object under Miniflare
(`src/index.test.ts`) along with the pure parts (`src/logic.test.ts`).
`@cloudflare/vitest-plugin` supports Vitest 4 only, so this folder stays on
Vitest 4 while the site uses 5.

The site needs `NEXT_PUBLIC_PRESENCE_URL` (this worker's `wss://` URL) and the same
`PRESENCE_SECRET`. Allowed page origins are `ALLOWED_ORIGINS` in `wrangler.jsonc`;
the `CONNECTS` rate limit there caps new visitor sockets per network per minute.

The worker imports the site's shared presence rules and types from
`src/features/admin/` (`presence.ts`, `presence-protocol.ts`, `types.ts`) and
`src/lib/network.ts`, so both count people the same way; wrangler bundles them.
Because the two are deployed separately, `PRESENCE_PROTOCOL` in
`presence-protocol.ts` is sent in every snapshot, and the dashboard warns when
it differs from the site's. Bump it with any change to what the two say to each
other, and deploy the worker before the site.

Dashboards send their token as a WebSocket subprotocol (`gd-admin, <token>`),
never in the URL. Tokens last five minutes and the dashboard hands the open
socket a newer one as it polls (about every three minutes); the worker closes a
dashboard whose token runs out, so a browser that was signed out (it gets no new
tokens) loses the feed within five minutes, and at once when the site reports
"sign out everywhere".

The worker was built for Cloudflare's free plan (100,000 requests a day, the
Worker and the Durable Object together) and spent as few as it could. The
account is on Workers Paid now, where a million requests cost cents, so the
timings are chosen for what the operator sees, not for the count:

- A tab connects once it has been in view for two seconds in all (it was 15),
  so real short visits count and a page opened and closed at once does not.
- A tab says it went out of view after five seconds (it was a minute); the
  worker dates "hidden since" back by as much.
- A tab pings every 15 seconds. Pings are answered by the runtime without
  waking the object. A tab in view that misses three (50 seconds) is taken to
  be gone, so a closed laptop or a locked phone stops counting as a person
  here; a tab out of view is given two and a half minutes, because browsers
  slow its timers.
- While a dashboard is open the object sweeps every 15 seconds (it was every
  minute), which is when an open dashboard hears that a quiet tab is gone.
  While only visitors are connected it sweeps every 15 minutes: nobody is
  looking, and counts and peaks never include quiet sockets.
- A dashboard out of view keeps its socket for 15 minutes (it was one).

Kept as they were, because changing them would show the operator nothing:

- While no dashboard is open, the site parks its feed events in Redis; the
  object fetches them from the site's `/api/admin/presence-feed`
  (`SITE_ORIGIN`, with `PRESENCE_SECRET`) when a dashboard connects, so they
  are in its first snapshot, and each minute while one stays open.
- Dashboard tokens last five minutes and are renewed about every three. That
  is a security timing: do not lengthen it.

The limits are now there for abuse, not cost, and stay: the `CONNECTS` rate
limit (new sockets per network per minute), 64 sockets per network, and per
socket 30 changes and 120 messages a minute before it is closed. So one
network can cause at most 60 connects and 7,680 messages a minute, which
Cloudflare bills as about 500 requests a minute (20 incoming WebSocket
messages count as one): well under a dollar a day at the very worst.

What is billed: a visitor connect is two requests (Worker and object), 20 tab
messages are one, and every sweep alarm and site event is one. The object is
not billed for time while it hibernates between them. Check the use with the
GraphQL datasets `workersInvocationsAdaptive` and
`durableObjectsInvocationsAdaptiveGroups`.
