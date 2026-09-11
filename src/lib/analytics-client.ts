import type { PostHog } from "posthog-js";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
let posthogPromise: Promise<PostHog> | null = null;

function getPostHog() {
  if (!posthogKey) return null;

  posthogPromise ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init(posthogKey, {
      // Use a non-default first-party path to reduce adblock filter hits.
      api_host: "/phx9a",
      ui_host: "https://us.posthog.com",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_dead_clicks: false,
      capture_performance: false,
      disable_external_dependency_loading: true,
      disable_session_recording: true,
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
