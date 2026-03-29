"use client";

import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { ThemeProvider } from "next-themes";

if (typeof window !== "undefined") {
  // Only initialize PostHog if the environment variables are available
  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

  if (posthogKey) {
    posthog.init(posthogKey, {
      // Use a non-default first-party path to reduce adblock filter hits.
      api_host: "/phx9a",
      ui_host: "https://us.posthog.com",
      person_profiles: "always",
    });
  }
}

export function CSPostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      storageKey="gitdiagram-theme"
    >
      <PostHogProvider client={posthog}>{children}</PostHogProvider>
    </ThemeProvider>
  );
}
