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

The worker runs on Cloudflare's free plan: 100,000 requests a day, counting the
Worker and the Durable Object together. A visitor connect costs two, and every
tab message, sweep alarm and site event wakes the object once (pings answered by
the runtime cost nothing). So tabs connect only after 15 seconds in view, report
going out of view only after a minute, dashboards close their socket after a
minute out of view, and sweeps run every minute while a dashboard watches and
every 15 minutes otherwise. While no dashboard is open, the site parks its feed
events in Redis; the object fetches them from the site's
`/api/admin/presence-feed` (`SITE_ORIGIN`, with `PRESENCE_SECRET`) when a
dashboard connects and at every sweep. That fetch is a subrequest, which the
daily limit does not count. Check the day's use with the GraphQL datasets
`workersInvocationsAdaptive` and `durableObjectsInvocationsAdaptiveGroups`.
