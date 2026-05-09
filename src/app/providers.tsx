"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { ThemeProvider } from "next-themes";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (typeof window !== "undefined") {
  // Only initialize PostHog if the environment variables are available
  if (posthogKey) {
    posthog.init(posthogKey, {
      // Use a non-default first-party path to reduce adblock filter hits.
      api_host: "/phx9a",
      ui_host: "https://us.posthog.com",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      person_profiles: "identified_only",
    });
  }
}

function PostHogPageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!posthogKey || typeof window === "undefined") {
      return;
    }

    const queryString = searchParams.toString();
    const currentUrl = `${window.location.origin}${pathname}${
      queryString ? `?${queryString}` : ""
    }`;

    posthog.capture("$pageview", {
      $current_url: currentUrl,
    });
  }, [pathname, searchParams]);

  return null;
}

export function CSPostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      storageKey="gitdiagram-theme"
    >
      <PostHogProvider client={posthog}>
        <Suspense fallback={null}>
          <PostHogPageviewTracker />
        </Suspense>
        {children}
      </PostHogProvider>
    </ThemeProvider>
  );
}
