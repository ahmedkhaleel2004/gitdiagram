# Traffic protection

Repository browsing must not regenerate unchanged pages and social images for
every crawler visit. Repository pages are cached for six hours and social
images for one day. Successful public generations immediately invalidate the
page, data tag, and image route for normalized and requested URL casing. Both
social metadata fields use the same Open Graph image; old Twitter image URLs
redirect without rendering a second image. Mixed-case repository and image URLs
redirect to lowercase cache entries. Browse links only load a repository page
when opened; they do not prefetch every visible result.

The rules below came from Vercel's firewall and were carried over when the
site moved to Cloudflare. They now live in two places.

## In the Worker (deployed with the site)

`edgeDecision` in `src/lib/cloudflare-edge.ts`, applied by `cloudflare/edge.ts`
and `cloudflare/worker.ts`; `src/lib/cloudflare-edge.test.ts` covers it.

| Rule | Matches | Action |
| --- | --- | --- |
| Generation rate limits | `/api/generate/stream` (20 a minute per address), `/api/generate/cost` and `/api/generate/cancel` (60), `/api/diagram-state` (120) | 429 |
| Container wake-up limit | `/api/video/generate` and `/api/video/render` (30 a minute per address) | 429 |
| Repository page limit | `/[username]/[repo]` pages and their social images, 120 a minute per address; search crawlers Cloudflare has verified are exempt | 429 |
| ClaudeBot repository crawl | User agent contains `ClaudeBot`, on repository pages | Deny |
| Amazonbot and Brightbot repository crawl | User agent contains `Amazonbot` or equals `Brightbot 1.0`, on repository pages and their social images | Deny |
| Scanner paths | Paths only vulnerability scanners ask for | 404 |

The limits themselves are the `ratelimits` bindings in `wrangler.jsonc`.

## On the zone (Cloudflare dashboard, Security > WAF)

Managed separately from deployments.

| Rule | Conditions | Action |
| --- | --- | --- |
| Machine endpoints | `/mcp`, the PostHog proxy path, `/api/internal/*`, `/api/admin/presence-feed` | Skip (never challenged) |
| Repository scraper verification | Repository pages, from AS37963, AS212317 or AS213230, or with one of the two user agents below | Managed challenge |
| Cost guardrail | One address making 100 requests that run the Worker in 10 seconds; static files, the machine endpoints and verified search crawlers are not counted | Block for 10 seconds |

The challenge conditions were selected after observing repeated bulk
repository crawls. The crawler rotated Safari and Chrome signatures, then
switched to other hosting networks, so the rule matches either the source
networks or these exact user agents, always restricted to repository pages:

```text
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0.1 Safari/605.1.15
Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36
```

Real browsers matching those conditions must complete verification. Other
ordinary traffic, Googlebot, Bingbot, and social link preview clients do not
match. The Amazonbot robots policy also discourages future repository crawls.

## Changing a rule

Inspect the zone rules in the dashboard, or with the API:
`GET /zones/<zone-id>/rulesets/phases/http_request_firewall_custom/entrypoint`
and `.../phases/http_ratelimit/entrypoint`. Before changing one, look at the
traffic it matches (Security > Events, or `bunx wrangler tail gitdiagram`) and
use PostHog for browser behaviour. Verify both matching traffic and ordinary
requests afterwards. Event counts are request volume, not unique visitors.

If a zone rule starts matching legitimate traffic, switch only that rule's
action to Log. A Worker rule changes in code and ships with a deploy.
