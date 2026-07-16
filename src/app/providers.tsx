"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ThemeProvider } from "next-themes";

import { WebVitals } from "~/components/web-vitals";
import { captureAnalyticsEvent } from "~/lib/analytics-client";

function PostHogPageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const queryString = searchParams.toString();
    const currentUrl = `${window.location.origin}${pathname}${
      queryString ? `?${queryString}` : ""
    }`;

    captureAnalyticsEvent("$pageview", {
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
      <Suspense fallback={null}>
        <PostHogPageviewTracker />
      </Suspense>
      <WebVitals />
      {children}
    </ThemeProvider>
  );
}
