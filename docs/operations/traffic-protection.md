# Traffic protection

Repository browsing must not regenerate unchanged pages and social images for
every crawler visit. Repository pages use a 30-minute ISR interval, while social
images use one day. Successful public generations invalidate the page, data tag,
and both image routes for normalized and requested URL casing. Browse links only
load a repository page when opened; they do not prefetch every visible result.

The Vercel firewall also has these project-level rules, managed separately from
deployments:

| Rule | Conditions (all must match) | Action |
| --- | --- | --- |
| Amazonbot repository crawl | User agent contains `Amazonbot`; route is `/[username]/[repo]`, `/[username]/[repo]/opengraph-image`, or `/[username]/[repo]/twitter-image` | Deny |
| Hetzner Safari repository scrape | Route is `/[username]/[repo]`; ASN is `212317` or `213230`; user agent exactly matches the signature below | Challenge |

The hosting-network rule uses this exact user agent:

```text
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0.1 Safari/605.1.15
```

These conditions were selected after observing repeated bulk repository crawls.
They do not apply to ordinary Safari traffic outside those hosting networks,
Googlebot, Bingbot, or social link preview clients. The Amazonbot robots policy
also discourages future repository crawls. Existing API rate limits and alert
notifications remain enabled.

Inspect current rules with `vercel firewall rules list --expand`. Before changing
them, inspect exact alert-window request metrics by route, user agent, ASN,
prefetch, cache result, HTTP status, and firewall action. Verify both matching
traffic and ordinary requests after publishing. Alert counts are request volume,
not unique visitors; check product analytics and billing independently.

If a rule starts matching legitimate traffic, change only that rule to logging:

```sh
vercel firewall rules edit 'Amazonbot repository crawl' --action log --yes
vercel firewall diff
vercel firewall publish --yes
```

Use the relevant rule name for the hosting-network challenge. Check for unrelated
draft changes before publishing. Keep alerts enabled so new problems remain
visible.
