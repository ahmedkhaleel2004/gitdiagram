import type { PostHog } from "posthog-js";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
let posthogPromise: Promise<PostHog> | null = null;

function getPostHog() {
  if (!posthogKey) return null;

  posthogPromise ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init(posthogKey, {
      defaults: "2026-06-25",
      // Use a non-default first-party path to reduce adblock filter hits.
      api_host: "/phx9a",
      ui_host: "https://us.posthog.com",
      autocapture: {
        dom_event_allowlist: ["click", "submit"],
        capture_copied_text: false,
      },
      capture_pageview: false,
      capture_pageleave: true,
      capture_dead_clicks: true,
      rageclick: true,
      capture_heatmaps: true,
      capture_performance: { web_vitals: true, network_timing: false },
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
      // Recorder and web-vitals extensions use the same first-party proxy.
      disable_external_dependency_loading: false,
      disable_session_recording: false,
      enable_recording_console_log: false,
      session_recording: {
        // 0.5% sustains ~22k sessions/day within the 5k monthly free allowance.
        // The project UI only supports whole percentages. Its 10s minimum
        // duration and separate $0 billing cap also apply to this sample.
        sampleRate: 0.005,
        maskAllInputs: true,
        blockSelector:
          ".ph-no-capture, input[type='hidden'], input[type='file']",
        strictMinimumDuration: true,
        recordHeaders: false,
        recordBody: false,
        // Requests can contain credentials or private repository contents.
        maskCapturedNetworkRequestFn: () => null,
      },
      disable_surveys: true,
      person_profiles: "identified_only",
    });
    return posthog;
  });

  return posthogPromise;
}

export function captureAnalyticsEvent(
  eventName: string,
  properties?: Record<string, boolean | number | string | null>,
) {
  const posthog = getPostHog();
  if (!posthog) return;

  void posthog.then((client) => {
    client.capture(eventName, properties);
  });
}
