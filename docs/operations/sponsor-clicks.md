# Sponsor campaign reporting and scheduling

## CodeRabbit

[CodeRabbit campaign dashboard](https://us.posthog.com/project/113380/dashboard/2132862)
contains only `coderabbit-2026-10`, with fixed campaign dates and test events
excluded. It reports website ad loads, website clicks and CTR, clicks by all four
placements, daily results by placement, unique clicking browsers, and the $999
fee divided by all clicks. README clicks are separate from website CTR; README
impressions and CTR are unavailable. Blank CTR means no measured impressions.
Daily rows use the project's America/New_York timezone (matching Toronto).
The read-only sharing URL is kept out of the repository.

Sent ends at `2026-10-19T22:23:01.236Z` (October 19, 6:23 p.m. Toronto).
CodeRabbit takes over immediately, with those lead-in hours complimentary before
the booked October 20–November 18 run. It ends at `2026-11-19T05:00:00Z`
(November 19, midnight Toronto, after the daylight-saving change). Both campaigns
are exclusive. No renewal or rotation is configured for the paid CodeRabbit run.

The website resolves `/api/sponsor` against server time with no caching, refreshes
on tab visibility changes, and switches at the next boundary even on an open page.
This works on previously cached pages without a launch-day deployment. When no
campaign is active, the placement links to `/advertise` as vacant inventory.

The GitHub `Sponsor README schedule` workflow updates only the marked sponsor
block using the same schedule and creative. It runs at 22:24 UTC on October 19,
retries through that hour, removes CodeRabbit after expiry, and reconciles daily.
GitHub may delay scheduled jobs; the website handoff does not depend on Actions.
The workflow is also manually dispatchable. Old README revisions keep their
original campaign-specific redirect links.

CodeRabbit uses the approved preview copy, official light/dark wordmarks, and the
current website layout. Its destination is `https://www.coderabbit.ai/`, with
`utm_source=gitdiagram`, `utm_medium=sponsorship`,
`utm_campaign=coderabbit_30_days`, and placement-specific `utm_content`.
No custom UTM link was supplied in the accepted email thread. If one is supplied,
set the campaign destination in `src/lib/sponsor-campaign.ts`; existing UTM
parameters are preserved and missing defaults filled in.

## Website impressions

An impression is recorded immediately when the ad renders on a page, including
below the fold. There is **no viewport requirement or time threshold**. React
re-renders do not add impressions; loading a new page/route does. This is a loaded
ad count, not a claim that a visitor looked at the ad. On diagram pages, the ad
must actually render below a ready diagram before its impression is recorded.

`POST /out/:campaign/impression` accepts only website placements, a random event
UUID, and same-origin JSON. It uses `sponsor_impression` with the same anonymous
cookie as clicks. Inactive campaigns, previews, bots, speculative requests and
DNT/GPC opt-outs do not count. `?test=1` permits controlled, excluded verification
events before launch. No page/repository path or visitor IP is sent with the event.
Website CTR divides website clicks by loaded website ads; it never includes
README clicks. As with clicks, blocked requests, unavailable analytics, and
PostHog ingestion caps can cause undercounting. Signups/conversions remain in the
sponsor's own analytics. The existing $0 billing caps are unchanged.

For the separate preview project, set `SPONSOR_PREVIEW_CAMPAIGN=coderabbit-2026-10`.
Production hostnames ignore that override. Preview visits never enter reporting.

## Sent

[Sent campaign dashboard](https://us.posthog.com/project/113380/dashboard/2114998)
is in the existing private PostHog project. It shows total clicks, unique
browsers, the $749 campaign fee divided by clicks so far, placement totals, and
daily clicks by placement. A read-only share link exposes this campaign dashboard
only, so Ahmed and Sent can use the same report and filters. Anyone with that link
can view it; keep the token-bearing URL out of this public repository. The rest of
the PostHog project remains private. Shared reports refresh periodically, so use
the same report and refresh time when comparing figures.

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

Keep old campaign redirect URLs working for historical README revisions. Use a
new campaign ID and a dated dashboard so reports do not mix different paid runs.
Add new bookings to the schedule, then verify start/end boundaries and README
rendering before shipping. Billing is never renewed by the schedule.

Implementation references:
[Next.js after](https://nextjs.org/docs/app/api-reference/functions/after),
[PostHog capture API](https://posthog.com/docs/api/capture).
