# PostHog usage and replay

Project: [GitDiagram 113380](https://us.posthog.com/project/113380).

The browser enables click/submit autocapture, page views and exits, click/scroll
heatmaps, rage/dead clicks, native Web Vitals, unhandled errors, and sampled session
replay. Native `$web_vitals` replaces the separate custom `web_vital` events, avoiding
duplicate collection and making the metrics available in PostHog's built-in views.

## Free-tier controls

Configured September 18, 2026 in organization billing:

- Session replay: **$0 cap**, 5,000 web recordings per billing period.
- Product analytics: **$0 cap**, 1,000,000 events per billing period.
- Error tracking: **$0 cap**, 100,000 exceptions per billing period.
- Feature flags: **$0 cap**, 1,000,000 requests per billing period.

Caps apply across the organization and stop ingestion when the allowance is
exhausted. Data dropped while capped is not recovered later. Caps are independent
of sampling; keep them at zero when changing collection settings. Check the live
billing page for the current period and allowances.

Replay uses two PostHog V2 recording groups (union, without duplicate recordings):

- **Priority audiences: 100%, no minimum duration**, gated by the boolean feature
  flag [`replay-priority-audiences`](https://us.posthog.com/project/113380/feature_flags/896554).
  The flag matches any of: macOS in the US or Canada; any device in California,
  Washington, New York, Ontario, or British Columbia; London, UK and recognized
  London borough/locality names. Canada outside Ontario/BC is macOS only.
- **General sample: 20%, 10 seconds minimum duration**, with no conditions.

Both groups are managed in PostHog project settings, with strict minimum duration
in the SDK. The legacy fallback is also 20% with a 10-second minimum. Do not add a
client `sampleRate`, which would interfere with remote sampling controls. No URL
or event triggers bypass these rules. To roll back, set
`session_recording_trigger_groups` to `null`, retaining the legacy fallback.

The SDK supplies browser/OS properties before its first flag evaluation using
PostHog's official customization. `/api/analytics-context` adds only Vercel's
country and first-level region codes, as flag-only `replay_region_country` and
`replay_region_code` overrides. PostHog's native flag GeoIP includes country/city
but not state/province. The endpoint is uncached and does not return IP addresses,
coordinates, or credentials; it does not create person profiles. A failed lookup
clears stale region overrides and leaves native country/device/city targeting and
the general sample available. Initialization waits at most two seconds for it.

Location is approximate IP geolocation, not a guaranteed physical boundary.
London uses country `GB` plus city/locality names, not every possible Greater
London borough code: those codes are unavailable during native flag evaluation.
VPNs, missing geolocation, blockers, or closing before SDK initialization can
prevent capture. macOS identifies Macs, not specifically MacBook hardware.

The 88 complete days before the September 16 surge averaged 436 sessions/day;
the maximum was 1,065. The most recent 60 pre-spike days averaged about 12,600
sessions per 30 days. Of 25,235 sessions in July 18–September 15, 2,530 matched
the priority union (counting overlaps once). This projects to 1,265 priority
recordings plus 2,271 general recordings per 30 days: **3,536 total**, or **4,596
with another 30% traffic increase**, before the general duration filter.
This uses historical PostHog geography as an estimate for Vercel region matching.

The September 17 peak was 22,372 sessions, and September 18 remained elevated at
roughly 650–800 sessions/hour when checked. Sustained surge traffic could exhaust
5,000 recordings in about a day. The $0 cap then stops ingestion, including
priority recordings, until the allowance resets. The 100% rule is subject to that
cap; it does not reserve quota for later priority sessions. This is fixed sampling,
not adaptive sampling. The earlier 0.5% rate was raised to 25%, then replaced by
these priority groups at the user's request for broader and targeted coverage.

## Recording boundaries

- Analytics starts only after legacy credentials have been migrated out of browser
  storage, preserving the existing fail-closed migration gate.
- Both credential dialogs have `ph-no-capture`, blocking their entire subtrees from
  replay and autocapture. All inputs are masked; hidden/file inputs are blocked.
- Console recording, request headers/bodies, and network capture are disabled.
- The network redaction callback preserves PostHog's URL-only page metadata,
  stripping query strings and fragments. Returning `null` for every callback also
  drops rrweb's viewport metadata, causing white-screen playback until a recorded
  viewport resize. Actual network entries are still rejected.
- The SDK uses `posthog-js/full/no-external`, bundling replay, dead-click capture,
  Web Vitals, and exception capture into the app's lazy-loaded JavaScript chunks.
  This avoids separate recorder/extension filenames matched by uBlock Origin's
  default filters. Remote configuration, flags, events, and replay uploads still
  use the same-origin `/phx9a` proxy; CSP is unchanged. Explicitly blocking that
  path or disabling JavaScript can still prevent collection.
- Surveys are disabled in the client. No new user-facing surveys or experiments are
  launched by enabling telemetry.

See [billing limits](https://posthog.com/docs/billing/limits-alerts),
[replay controls](https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record),
[flag property overrides](https://posthog.com/docs/feature-flags/property-overrides),
and [replay privacy](https://posthog.com/docs/session-replay/privacy).
