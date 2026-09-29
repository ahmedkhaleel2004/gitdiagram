"use client";

import { useCallback, useEffect, useState } from "react";

import {
  parseGitHubConnectResult,
  withoutGitHubConnectResult,
  type GitHubConnectResult,
  type GitHubConnectSource,
} from "~/features/credentials/github-connect";
import { captureAnalyticsEvent } from "~/lib/analytics-client";

/**
 * Picks up the outcome of a "Continue with GitHub" sign-in that started from
 * `source` (a repository page, or the header's dialog), reports it once, and
 * removes it from the address so a reload does not repeat it.
 */
export function useGitHubConnectResult(source: GitHubConnectSource) {
  const [result, setResult] = useState<GitHubConnectResult | null>(null);

  useEffect(() => {
    const parsed = parseGitHubConnectResult(window.location.search);
    if (!parsed || parsed.source !== source) return;
    window.history.replaceState(
      window.history.state,
      "",
      withoutGitHubConnectResult(window.location.href),
    );
    if (parsed.status === "connected") {
      captureAnalyticsEvent("github_connect_completed", { source });
    } else {
      captureAnalyticsEvent("github_connect_failed", {
        source,
        reason: parsed.reason,
      });
    }
    setResult(parsed);
  }, [source]);

  const dismiss = useCallback(() => setResult(null), []);
  return [result, dismiss] as const;
}
