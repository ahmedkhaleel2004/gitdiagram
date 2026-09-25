# PostHog usage and replay

Project: [GitDiagram 113380](https://us.posthog.com/project/113380).

The browser enables click/submit autocapture, page views and exits, click/scroll
heatmaps, rage/dead clicks, native Web Vitals, unhandled errors, and session replay configured for all sessions. Native `$web_vitals` replaces the separate custom `web_vital` events, avoiding
duplicate collection and making the metrics available in PostHog's built-in views.

## Startup credits and collection

Verified September 25, 2026 after PostHog approved GitDiagram for the startup
program: **US$50,000 in credits**, with the standard 12-month expiry waived under
the open-source provision. The billing API reports `discount_amount_usd: 50000`
and `amount_off_expires_at: null`. Credits are a finite usage balance, not a
monthly allowance or cash payment.

Support ticket #75104 confirms that the credits cover Product Analytics, Session
Replay, and the other ordinary products, but exclude **PostHog AI, Self-driving
inbox, Replay vision, and PostHog Desktop**. Those four products retain **$0
billing limits** (`posthog_ai`, `inbox`, `replay_vision`, `posthog_code_usage`).

The user's instruction to remove the old cost restrictions supersedes the former
$10 Product Analytics and $0 Session Replay caps. Billing limits were removed for:

- Product Analytics and Session Replay.
- Data pipelines, Feature flags & Experiments, Surveys, and Data warehouse.
- Error tracking, AI Observability, Logs, and Workflows.

PostHog enforces caps even when credits would cover usage. The API now reports
`usage_limit: null` for those ten products, with no next-period cap overrides.
Paid platform/support add-ons were not enabled. The user wants full credit-covered
usage with no out-of-pocket charges and explicitly rejected restoring $0 caps on
covered products, since those caps would also stop credit-covered ingestion.
There is no verified self-service credit-balance cutoff. Removing caps can permit
charges after credits are exhausted; do not promise otherwise. A support request
for an account-level credit-only hard stop is pending in ticket #75104. Keep the
four excluded AI products at $0; their free allowances remain available.

## Session replay coverage

Replay now has one PostHog V2 trigger group:

- **All sessions — 100%**, with no URL, event, feature-flag, geographic, or device
  condition and **no minimum duration**.
- V2 fallback sampling is **100%**; legacy sample rate is **1.00**, with a legacy
  minimum duration of **0 ms** and no linked flag.
- Replay is enabled, with no recording-domain restriction or URL blocklist.

The former priority-only 5% group and paused general group were replaced. The
historical `replay-priority-audiences` flag (ID `896554`) remains for reference but
is no longer used by recording rules. The client's coarse region/property flag
overrides do not restrict recording. Do not add a client `sampleRate`, which would
interfere with the remote settings.

Verified the same-origin production configuration at
`/phx9a/array/<project-key>/config`, then used a fresh Helium private session with a
marked URL. PostHog stored its pageview, autocapture, and Web Vitals, as well as a
37-second web recording with two clicks (session
`01a0d851-3f4b-7d00-8af8-6621d5d506ec`). A direct replay-store query also confirmed a
stored batch. Sampling changes affect new sessions; sessions with an earlier
sampling decision can retain that decision until a new session starts.

100% is the configured selection rate, not a guarantee of delivery from every
browser. Opt-outs, disabled JavaScript/storage, explicit blockers, network
failures, or early exits can still prevent capture. The masking and recording
boundaries below remain unchanged.

## Video events

The explainer player and share row send custom events (added September 25,
2026, `src/features/explainer/watch-analytics.ts`): `video_started` (first play
per page load), `video_progress` with `percent` 25/50/75/100 of the film
actually played (seeks and gaps over a second never count, so it can only
undercount), and `video_shared` with `method` (`mp4_landscape`, `mp4_vertical`,
`native`, `link`, `badge`, `picture`). Each carries `video_repo`,
`video_created_at`, `video_model` and `video_duration`. Compare prompt versions
by `video_created_at`: films made from September 25, 2026 on the practical-first
prompt (see `experiments/video-practical/`).

## Sponsor events and /advertise figures

Sponsor clicks and impressions are server-side analytics events (see
[sponsor-clicks.md](./sponsor-clicks.md)). Impressions count once per ad
placement per page view, so their volume tracks pageviews of the home, diagram
and browse pages: about 77,000 in the 30 days to September 17, 2026 (an estimate
from the /advertise snapshot, during the traffic surge). Clicks add a few
hundred. That is well under the analytics allowance, so sponsor events are not
sampled; sampling them would also change the paid campaign reports.

The /advertise page reads its figures through the query API, not ingestion. The
30-day query is bounded to its window and refreshes hourly; the lifetime query
scans all history and refreshes daily. Both use `refresh: "blocking"` on rounded
cutoffs so PostHog can reuse cached results, and a failed refresh keeps serving
the last success (or the dated snapshot in `src/server/sponsor-stats.ts`).

## Recording boundaries

- Analytics starts only after legacy credentials have been migrated out of browser
  storage, preserving the existing fail-closed migration gate.
- Only the secret input in each credential dialog has `ph-no-capture`, excluding
  it from replay and autocapture while keeping the instructions, buttons, and
  dialog layout visible. Blocking the entire dialog produces an empty box in
  playback; older recordings cannot recover those omitted contents. All other
  inputs remain masked; hidden/file inputs are blocked.
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
