# Vercel and Railway failover

GitDiagram has one application implementation and two deployment targets:

- **Primary:** Vercel serves `gitdiagram.com`.
- **Standby:** Railway runs the same Next.js application from the same commit at
  `standby.gitdiagram.com`.
- **Stable standby API:** `api.gitdiagram.com` points at the same Railway
  service.

The Railway target is not the deleted Python backend. It contains the same Route Handlers, graph schema, deterministic Mermaid compiler, cancellation protocol, quota logic, and persistence code as Vercel.

## Why this stays simple

- R2 owns diagram artifacts.
- Upstash owns quota, cancellation, and lock state.
- Neither deployment relies on a local filesystem or process-local coordination.
- Browser and API traffic stay on one origin during a full-site cutover.
- Railway App Sleeping stops compute charges after an idle period and wakes on the next request.

## Verify the standby

The Railway service has App Sleeping enabled. Wake and verify it with the stable
domain:

```bash
curl --fail-with-body https://api.gitdiagram.com/api/healthz
curl --fail-with-body \
  --request POST https://api.gitdiagram.com/api/generate/cost \
  --header "Content-Type: application/json" \
  --data '{"username":"octocat","repo":"Hello-World"}'
```

A wake from sleep can make the first health request slower. Wait for a successful health response before routing production traffic.

The Railway-provided domain
`gitdiagram-api-production.up.railway.app` remains available as a last-resort
route if the `gitdiagram.com` DNS zone itself has a problem.

## Cut over to Railway

1. Confirm Railway is running the same Git commit as production.
2. Wake it with `/api/healthz` and run a cost request plus one small streamed generation.
3. Open `https://standby.gitdiagram.com` for an immediate independent full-app
   fallback, or route `gitdiagram.com` to the prepared Railway custom-domain
   target for a transparent public cutover.
4. Confirm the homepage, a persisted diagram, generation, cancellation, and R2 persistence.
5. Leave the Vercel deployment intact until the incident is resolved.

Because the whole app moves together, no browser CORS toggle or public backend selector is needed.

## Return to Vercel

1. Confirm `https://gitdiagram.com/api/healthz` on the intended Vercel deployment or its deployment URL.
2. Route `gitdiagram.com` back to Vercel.
3. Run the same health, cost, generation, cancellation, and persistence checks.
4. Leave Railway in App Sleeping mode as the standby.

## Deploy both targets

Vercel:

```bash
vercel deploy --prod
```

Railway normally follows `main` through its connected GitHub source. A manual deployment is also available:

```bash
railway service redeploy --service gitdiagram-api --environment production
```

The checked-in `railway.json` fixes the Dockerfile, health check, and restart policy. The service-level App Sleeping flag is managed by Railway because it is an infrastructure setting rather than application code.
