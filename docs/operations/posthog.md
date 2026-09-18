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

Replay samples **25% of sessions**, managed in PostHog project settings. The client
does not override this rate, so changes do not require a deployment.
The project also requires **10 seconds minimum duration**, enforced with strict
minimum duration in the SDK. No URL or event triggers bypass the sample.

The 88 complete days before the September 16 surge averaged 436 sessions/day;
the maximum was 1,065. The most recent 60 pre-spike days averaged about 12,600
sessions per 30 days. At 25%, this yields about 3,160 recordings per month,
or 4,110 with another 30% traffic increase, before the duration filter.

The September 17 peak was 22,372 sessions, and September 18 remained elevated at
roughly 650–800 sessions/hour when checked. This rate deliberately prioritizes more
recordings over spreading them across the entire billing period: sustained surge
traffic could exhaust 5,000 recordings in 1–2 days. The $0 cap then stops ingestion
until the allowance resets. This is fixed sampling, not adaptive sampling; do not
assume it will automatically decrease during a spike. The earlier 0.5% rate was
replaced at the user's request because it was too conservative for normal traffic.

## Recording boundaries

- Analytics starts only after legacy credentials have been migrated out of browser
  storage, preserving the existing fail-closed migration gate.
- Both credential dialogs have `ph-no-capture`, blocking their entire subtrees from
  replay and autocapture. All inputs are masked; hidden/file inputs are blocked.
- Console recording, request headers/bodies, and network capture are disabled.
- Recorder extensions use the existing same-origin `/phx9a` proxy; CSP is unchanged.
- Surveys are disabled in the client. No new user-facing surveys or experiments are
  launched by enabling telemetry.

See [billing limits](https://posthog.com/docs/billing/limits-alerts),
[replay controls](https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record),
and [replay privacy](https://posthog.com/docs/session-replay/privacy).
