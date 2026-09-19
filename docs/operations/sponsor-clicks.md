# Sponsor click reporting

[Sent campaign dashboard](https://us.posthog.com/project/113380/dashboard/2114998)
is in the existing private PostHog project. It shows total clicks, unique
browsers, the $749 campaign fee divided by clicks so far, placement totals, and
daily clicks by placement. It is not publicly shared.

The Sent campaign runs from September 19, 2026 at 18:23:01 EDT to October 19 at
18:23:01 EDT. Dedicated click capture went live September 19 at 19:29:40 EDT; it cannot
reconstruct earlier README clicks. The dashboard uses these fixed campaign dates
and excludes events with `is_test: true`.

## Capture path

All four placements use `/out/sent-2026-09?placement=home|diagram|browse|readme`.
The route immediately issues an uncached 302 to Sent with the original
`utm_source=gitdiagram`, `utm_medium=sponsorship`, `utm_campaign=sent_30_days`, and
the placement's `utm_content`. Both README links use `placement=readme`.

Next.js `after()` sends one `sponsor_click` event to the existing PostHog project
without holding up the redirect. Capture has a three-second timeout and fails
open for navigation. Destinations and placements are allowlisted in code; URL
parameters cannot turn this into an arbitrary redirect.

Properties are `campaign`, `sponsor`, `placement`, and `is_test`. The anonymous
distinct ID uses a random first-party `gd_sponsor_visitor` cookie, valid for 30
days, scoped to `/out`, Secure, HttpOnly, and SameSite=Lax. It deduplicates browsers
across all four placements. No visitor IP, referrer, repository path, or raw user
agent is sent to PostHog; person-profile processing and GeoIP enrichment are
disabled for these events.

Only requests to the production hostnames count. HEAD requests, known bot/link
preview user agents, speculative prefetch requests, and DNT/GPC requests are
excluded. The links continue to work for excluded visitors. This is best-effort
bot filtering, not proof that every recorded click is human. Unique browsers are
not unique people: cookie clearing, private browsing and different devices can
increase the count. Placement-level uniques overlap; the total deduplicates them.

Counts measure outbound clicks, not confirmed destination page loads, signups,
sales, ad impressions or click-through rate. Conversion data requires Sent's
analytics. Existing PostHog billing caps still apply and may stop ingestion; see
[the PostHog runbook](./posthog.md). Do not add the existing browser `$autocapture`
events to these counts, as that would double-count website clicks.

## Verification and future campaigns

Add `&test=1` to a placement URL for controlled production checks. These clicks
are captured with `is_test: true` and excluded from all dashboard tiles. Use HEAD
for routine URL checks without recording an event. Tests under
`src/server/sponsor-clicks.test.ts` cover attribution, anonymous identity, bot and
prefetch filtering, opt-outs, destination allowlisting, and capture failures.

When changing sponsors, keep old campaign redirect URLs working for historical
README revisions. Use a new campaign ID and new dated dashboard so reports do
not mix different paid runs. The campaign end does not automatically remove ads
or renew billing; placement changes remain a separate operation.

Implementation references:
[Next.js after](https://nextjs.org/docs/app/api-reference/functions/after),
[PostHog capture API](https://posthog.com/docs/api/capture).
