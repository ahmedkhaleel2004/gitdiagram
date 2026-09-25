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
never in the URL. Tokens last 45 seconds and the dashboard hands the open socket
a newer one as it polls; the worker closes a dashboard whose token runs out, so
a browser that was signed out (it gets no new tokens) loses the feed within a
minute, and at once when the site reports "sign out everywhere".
