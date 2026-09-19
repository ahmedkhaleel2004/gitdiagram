# Traffic protection

Repository browsing must not regenerate unchanged pages and social images for
every crawler visit. Repository pages use a six-hour ISR interval, while social
images use one day. Successful public generations immediately invalidate the page,
data tag, and image route for normalized and requested URL casing. Both social
metadata fields use the same Open Graph image; old Twitter image URLs redirect
at the CDN without rendering a second image. Mixed-case repository and image
URLs redirect to lowercase cache entries. Browse links only
load a repository page when opened; they do not prefetch every visible result.

The Vercel firewall also has these project-level rules, managed separately from
deployments:

| Rule | Conditions (all must match) | Action |
| --- | --- | --- |
| Amazonbot repository crawl | User agent contains `Amazonbot`; route is `/[username]/[repo]`, `/[username]/[repo]/opengraph-image`, or `/[username]/[repo]/twitter-image` | Deny |
| Block Brightbot repository crawl | User agent equals `Brightbot 1.0`; route is `/[username]/[repo]`, `/[username]/[repo]/opengraph-image`, or `/[username]/[repo]/twitter-image` | Deny |
| Repository scraper verification | Route is `/[username]/[repo]`; either ASN is `212317` or `213230`, or user agent exactly matches one of the signatures below | Challenge |

These conditions were selected after observing repeated bulk repository crawls.
The crawler rotated Safari and Chrome signatures, then switched to other hosting
networks. The challenge therefore matches either the original source networks or
these exact user agents, always restricted to repository pages:

```text
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0.1 Safari/605.1.15
Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36
```

Real browsers matching those conditions must complete verification. Other
ordinary traffic, Googlebot, Bingbot, and social link preview clients do not match
these signatures. The Amazonbot robots policy also discourages future repository
crawls. Existing API rate limits remain enabled. Paid Observability Plus is
disabled to avoid event charges; PostHog remains the product analytics system.

Inspect current rules with `vercel firewall rules list --expand`. Before changing
them, inspect available firewall traffic and runtime logs, and use PostHog for
browser behavior. Detailed historical Vercel queries require Observability Plus.
Verify both matching
traffic and ordinary requests after publishing. Alert counts are request volume,
not unique visitors; check product analytics and billing independently.

If a rule starts matching legitimate traffic, change only that rule to logging:

```sh
vercel firewall rules edit 'Amazonbot repository crawl' --action log --yes
vercel firewall diff
vercel firewall publish --yes
```

Use the relevant rule name for the scraper challenge. Check for unrelated
draft changes before publishing. Billing and platform security notifications are
separate from Observability Plus anomaly alerts; leave those notifications on.
