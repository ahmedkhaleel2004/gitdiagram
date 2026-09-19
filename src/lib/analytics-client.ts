import type { PostHog } from "posthog-js";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
let posthogPromise: Promise<PostHog> | null = null;

async function getReplayRegion() {
  // Clear previous overrides on every page load, including lookup failures.
  const region = { replay_region_country: "", replay_region_code: "" };
  try {
    const response = await fetch("/api/analytics-context", {
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return region;
    const data: unknown = await response.json();
    if (
      data &&
      typeof data === "object" &&
      "country" in data &&
      "region" in data
    ) {
      if (typeof data.country === "string" && /^[A-Z]{2}$/.test(data.country)) {
        region.replay_region_country = data.country;
      }
      if (
        typeof data.region === "string" &&
        /^[A-Z0-9]{1,3}$/.test(data.region)
      ) {
        region.replay_region_code = data.region;
      }
    }
  } catch {
    // Country/device targeting and ordinary sampling still work without region.
  }
  return region;
}

function getPostHog() {
  if (!posthogKey) return null;

  posthogPromise ??= Promise.all([
    // Bundle the recorder and capture extensions into Next.js chunks so their
    // standalone filenames cannot be blocked independently of the SDK.
    import("posthog-js/full/no-external"),
    import("posthog-js/customizations"),
    getReplayRegion(),
  ]).then(([{ default: posthog }, customizations, region]) => {
    posthog.init(posthogKey, {
      defaults: "2026-06-25",
      // Use a non-default first-party path to reduce adblock filter hits.
      api_host: "/phx9a",
      ui_host: "https://us.posthog.com",
      loaded: (client) => {
        // Flag-only overrides target anonymous first visits without person profiles.
        client.setPersonPropertiesForFlags(region, false);
        customizations.setAllPersonProfilePropertiesAsPersonPropertiesForFlags(
          client,
        );
      },
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
      // Extensions are bundled above; config, flags and events still use the proxy.
      disable_external_dependency_loading: true,
      disable_session_recording: false,
      enable_recording_console_log: false,
      session_recording: {
        // Priority audiences: 100%, no minimum. Others: 20%, 10s minimum.
        // Both recording groups are managed in PostHog settings.
        // The separate $0 billing cap stops ingestion at the free allowance.
        maskAllInputs: true,
        blockSelector:
          ".ph-no-capture, input[type='hidden'], input[type='file']",
        strictMinimumDuration: true,
        recordHeaders: false,
        recordBody: false,
        maskCapturedNetworkRequestFn: (request) => {
          // PostHog also calls this with only { name } for page URL metadata.
          // Dropping that removes rrweb's viewport event and leaves playback blank.
          // Real network entries remain excluded, including their payloads.
          if (Object.keys(request).some((key) => key !== "name")) return null;
          try {
            const url = new URL(request.name);
            return { ...request, name: `${url.origin}${url.pathname}` };
          } catch {
            return null;
          }
        },
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
