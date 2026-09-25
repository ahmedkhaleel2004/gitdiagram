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
Rotation is not implemented at all: the /advertise "shared website spot" needs it
before one is booked, and a schedule test rejects overlapping campaigns meanwhile.

One provider per tab (`SponsorCampaignProvider` in the root layout) resolves
`/api/sponsor` against server time with no caching, and switches at the next
boundary even on an open page. It rechecks on tab focus at most once a minute
(always within a minute of a boundary). Every slot reads that state, so a slot
mounted later starts from the confirmed campaign. Until the server has answered,
the page keeps the campaign it was rendered with and records no impressions; the
browser clock is never used. This works on previously cached pages without a
launch-day deployment. When no campaign is active, the placement links to
`/advertise` as vacant inventory.

The GitHub `Sponsor README schedule` workflow updates only the marked sponsor
block using the same schedule and creative. It runs every 15 minutes (a no-op
unless the active campaign changed), so it follows any boundary in
`src/lib/sponsor-campaign.ts` without date-specific cron lines. GitHub may delay
scheduled jobs; the website handoff does not depend on Actions. The workflow is
also manually dispatchable. Its actions are pinned to commit SHAs, and the token
is only given to the push step. The script needs no packages, so the job runs it
without `bun install`.

Old README revisions keep their campaign-specific links, but a click on a
campaign that is not active (ended or not started) redirects to `/advertise` and
is not recorded. The same applies to a click from a stale cached page.

CodeRabbit uses the approved preview copy, official light/dark wordmarks, and the
current website layout. Its destination is `https://www.coderabbit.ai/`, with
`utm_source=gitdiagram`, `utm_medium=sponsorship`,
`utm_campaign=coderabbit_30_days`, and placement-specific `utm_content`.
No custom UTM link was supplied in the accepted email thread. If one is supplied,
set the campaign destination in `src/lib/sponsor-campaign.ts`; existing UTM
parameters are preserved and missing defaults filled in.

## Website impressions

An impression is recorded immediately when the ad renders on a page, including
below the fold. There is **no viewport requirement or time threshold**. Each
campaign and placement counts once per page view: a visit to a pathname. React
re-renders and remounts on the same page do not add impressions (for example a
browse search, filter, sort or page change, or a diagram regenerate), nor do
query-string changes. Navigating to another pathname, or back again, starts a new
page view. This is a loaded ad count, not a claim that a visitor looked at the
ad. On diagram pages, the ad must actually render below a ready diagram before
its impression is recorded.

`POST /out/:campaign/impression` accepts only website placements, a page-view
UUID, and same-origin JSON. It uses `sponsor_impression` with the same anonymous
cookie as clicks. Inactive campaigns, previews, bots, speculative requests and
DNT/GPC opt-outs do not count. After the response, Redis (`SET NX`) accepts each
page view once and at most 120 impressions per network (IPv6 /64) and campaign
per hour; keys hold a hash of the network, never the IP. If Redis is down,
impressions are recorded without this check. `?test=1` permits controlled, excluded verification
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

All four placements use `/out/<campaign-id>?placement=home|diagram|browse|readme`
(for example `/out/sent-2026-09` and `/out/coderabbit-2026-10`). For the active
campaign, the route immediately issues an uncached 302 to the sponsor with
`utm_source=gitdiagram`, `utm_medium=sponsorship`, the campaign's `utm_campaign`
(`sent_30_days` for Sent), and the placement's `utm_content`. Both README links
use `placement=readme`. Other campaigns redirect to `/advertise` (see above).

Next.js `after()` sends one `sponsor_click` event to the existing PostHog project
without holding up the redirect. Redis (`SET NX`) first accepts one click per
network, campaign and placement every 30 minutes, so repeat clicks and replayed
redirects count once; it fails open if Redis is down. Capture has a three-second timeout and fails
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
bot filtering, not proof that every recorded click is human; the Redis dedupe
limits simple replays but not a botnet with many networks. Unique browsers are
not unique people: cookie clearing, private browsing and different devices can
increase the count. Placement-level uniques overlap; the total deduplicates them.

Counts measure outbound clicks, not confirmed destination page loads, signups,
sales, ad impressions or click-through rate. Conversion data requires Sent's
analytics. Existing PostHog billing caps still apply and may stop ingestion; see
[the PostHog runbook](./posthog.md). Do not add the existing browser `$autocapture`
events to these counts, as that would double-count website clicks.

## Verification and future campaigns

Add `&test=1` to a placement URL for controlled production checks. These clicks
are captured with `is_test: true`, skip the Redis dedupe, reach the sponsor even
outside the campaign dates, and are excluded from all dashboard tiles. Use HEAD
for routine URL checks without recording an event. Tests under
`src/server/sponsor-clicks.test.ts` cover attribution, anonymous identity, bot and
prefetch filtering, opt-outs, destination allowlisting, inactive campaigns,
dedupe, and capture failures.

Keep old campaign IDs in the schedule so historical README links resolve. Use a
new campaign ID and a dated dashboard so reports do not mix different paid runs.
Add new bookings to the schedule with a creative in `src/lib/sponsor-creative.ts`
(set `bookedFrom` if the paid run starts after a lead-in), then verify
start/end boundaries and README rendering before shipping. A new logo needs a
new file name in `public/sponsors`: those files are cached for a day plus a week,
and a test pins each file's hash. The /advertise availability line and booking
note follow the schedule. Billing is never renewed by the schedule.

Implementation references:
[Next.js after](https://nextjs.org/docs/app/api-reference/functions/after),
[PostHog capture API](https://posthog.com/docs/api/capture).
