"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ThemeProvider } from "next-themes";

import { WebVitals } from "~/components/web-vitals";
import { migrateLegacyCredentialStorage } from "~/features/credentials/api";
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

function AnalyticsAfterCredentialMigration() {
  const [migrationComplete, setMigrationComplete] = useState(false);

  useEffect(() => {
    let active = true;
    void migrateLegacyCredentialStorage()
      .then((complete) => {
        if (active && complete) {
          setMigrationComplete(true);
        }
      })
      .catch(() => {
        // Keep analytics disabled. A later app load can retry the migration.
      });
    return () => {
      active = false;
    };
  }, []);

  if (!migrationComplete) {
    return null;
  }

  return (
    <>
      <Suspense fallback={null}>
        <PostHogPageviewTracker />
      </Suspense>
      <WebVitals />
    </>
  );
}

export function CSPostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      storageKey="gitdiagram-theme"
    >
      <AnalyticsAfterCredentialMigration />
      {children}
    </ThemeProvider>
  );
}
