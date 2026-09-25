# gitdiagram-presence

The Cloudflare Worker behind gitdiagram.com/admin: live presence (one hibernating
WebSocket per open tab, held by a single Durable Object) and the operator's live
event feed. See the "Operator dashboard" section of the repo's `CLAUDE.md`.

```bash
bun install
cp .dev.vars.example .dev.vars   # add PRESENCE_SECRET="<32+ chars>"
bun run dev                      # ws://localhost:8787
bunx wrangler deploy             # production
bunx wrangler secret put PRESENCE_SECRET
```

The site needs `NEXT_PUBLIC_PRESENCE_URL` (this worker's `wss://` URL) and the same
`PRESENCE_SECRET`. Allowed page origins are `ALLOWED_ORIGINS` in `wrangler.jsonc`.
