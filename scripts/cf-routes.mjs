#!/usr/bin/env node
// Points the site's routes at a Worker.
//
//   node scripts/cf-routes.mjs <worker> [--zone gitdiagram.com] [pattern...]
//
// The routes (gitdiagram.com/* and www.gitdiagram.com/*) belong to
// `gitdiagram-edge`, the small Worker in front of the site's
// (wrangler.edge.jsonc); scripts/cf-deploy.sh runs this after uploading it.
// A route can be served by one Worker at a time and `wrangler deploy` will
// not take one from another Worker, so they are moved here, each in one API
// call (no moment without a Worker). `node scripts/cf-routes.mjs gitdiagram`
// takes the edge Worker out of the path: the site's Worker is complete
// without it.
//
// Needs CLOUDFLARE_API_TOKEN or ~/.config/gitdiagram/cloudflare-api-token.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

const args = process.argv.slice(2);
const zoneFlag = args.indexOf("--zone");
const zoneName = zoneFlag >= 0 ? args.splice(zoneFlag, 2)[1] : "gitdiagram.com";
const [worker, ...given] = args;
if (!worker) {
  console.error(
    "usage: node scripts/cf-routes.mjs <worker> [--zone name] [pattern...]",
  );
  process.exit(2);
}
const patterns = given.length ? given : [`${zoneName}/*`, `www.${zoneName}/*`];

const tokenFile = `${homedir()}/.config/gitdiagram/cloudflare-api-token`;
const token =
  process.env.CLOUDFLARE_API_TOKEN ??
  (existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : "");
if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not set");

async function api(method, path, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const answer = await response.json();
  if (!answer.success)
    throw new Error(`${method} ${path}: ${JSON.stringify(answer.errors)}`);
  return answer.result;
}

const [zone] = await api("GET", `/zones?name=${encodeURIComponent(zoneName)}`);
if (!zone) throw new Error(`No zone named ${zoneName}`);
const routes = await api("GET", `/zones/${zone.id}/workers/routes`);
for (const pattern of patterns) {
  const route = routes.find((candidate) => candidate.pattern === pattern);
  if (route?.script === worker) {
    console.log(`${pattern} is served by ${worker}`);
  } else if (route) {
    await api("PUT", `/zones/${zone.id}/workers/routes/${route.id}`, {
      pattern,
      script: worker,
    });
    console.log(`${pattern}: ${route.script} -> ${worker}`);
  } else {
    await api("POST", `/zones/${zone.id}/workers/routes`, {
      pattern,
      script: worker,
    });
    console.log(`${pattern}: new route to ${worker}`);
  }
}
