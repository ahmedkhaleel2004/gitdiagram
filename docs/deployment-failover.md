# Offline Railway recovery

GitDiagram has one application implementation and one live deployment target:

- **Live production:** Vercel serves the frontend and every backend Route Handler at `gitdiagram.com`.
- **Offline recovery option:** `Dockerfile` and `railway.json` can package the same application for Railway if Vercel must be replaced later.

There is no deployed Railway service, connected Railway source, Railway domain, or Railway DNS record. Railway is not receiving traffic and is not part of the normal request path.

## What is retained

The repository keeps a production-only Docker path that:

- builds the existing Next.js application with `output: "standalone"`;
- runs the generated server as a non-root user;
- respects the platform-provided `PORT`;
- exposes the same UI, Route Handlers, graph compiler, quota logic, cancellation protocol, and persistence code as Vercel;
- uses `/api/healthz` as its deployment health check.

This is not the old Python/FastAPI backend. No Python service or second API implementation is required.

## Recreate Railway only when needed

Do not run these commands during normal operation. In a real recovery:

1. Check out the exact production commit and pass the local quality gate.
2. Link this directory to an empty Railway project with `railway link`, or create a new one with `railway init --name gitdiagram`.
3. Create an unconnected service:

   ```bash
   railway add --service gitdiagram-api
   ```

4. Add the required variables from `.env.example`. Supply secret values through stdin so they do not enter shell history:

   ```bash
   railway variable set VARIABLE_NAME --stdin --service gitdiagram-api
   ```

5. Upload and deploy the current checkout:

   ```bash
   railway up --service gitdiagram-api
   ```

   `railway up` does not connect the service to GitHub and does not create a public domain by itself.

6. Add a temporary Railway domain, then verify health, cost estimation, a small streamed generation, cancellation, and persisted diagram state.
7. Only after those checks pass, make an explicit routing decision. Keep Vercel intact until the incident is resolved.

Because the whole Next.js application moves together, recovery does not need a browser CORS toggle, a public backend selector, or a data migration. R2 owns diagram artifacts and Upstash owns shared quota, cancellation, lock, and failure state.

## Return to Vercel

1. Verify `https://gitdiagram.com/api/healthz` and a small production generation.
2. Restore `gitdiagram.com` to the intended Vercel deployment if routing changed.
3. Remove the temporary Railway domains and delete the Railway service.
4. Confirm the Railway project has no services and the DNS zone has no Railway records.

The checked-in recovery files remain available for the next incident without keeping Railway compute, deployments, or public endpoints alive.
