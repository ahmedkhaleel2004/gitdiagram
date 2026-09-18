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

Replay samples **0.5% of sessions** in `src/lib/analytics-client.ts`. This local
setting overrides the project's 1% setting (the API accepts only two decimal places).
The project also requires **10 seconds minimum duration**, enforced with strict
minimum duration in the SDK. No URL or event triggers bypass the sample.

The measured September 17 peak was 22,372 sessions/day. At 0.5%, sustaining that
peak for 30 days yields about 3,356 recordings, or 4,195 with another 25% traffic
increase, before the duration filter. The pre-spike baseline was about 12,600
sessions/month, so this deliberately conservative setting records fewer sessions
when traffic settles. Review traffic before raising it; the billing cap still
protects spend if projections are wrong. Sampling is random, not a quota guarantee.

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
