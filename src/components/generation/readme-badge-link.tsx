"use client";

import { useEffect, useRef, useState } from "react";
import { readmeMarkdown } from "~/features/diagram/readme";
import { captureAnalyticsEvent } from "~/lib/analytics-client";
import styles from "./readout.module.css";

/**
 * "Add a badge to your README" in the readout's last line: copies the same
 * Markdown as the Export menu's README badge, for repository owners.
 */
export function ReadmeBadgeLink({
  owner,
  repo,
}: {
  owner: string;
  repo: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (reset.current) clearTimeout(reset.current);
    },
    [],
  );
  return (
    <button
      type="button"
      className={styles.linkButton}
      title="Copy Markdown for a README badge that opens this diagram"
      onClick={async () => {
        if (reset.current) clearTimeout(reset.current);
        try {
          await navigator.clipboard.writeText(
            readmeMarkdown(owner, repo, "badge"),
          );
          setStatus("copied");
          captureAnalyticsEvent("diagram_shared", {
            method: "readme_badge",
            placement: "readout",
            repository: `${owner}/${repo}`,
          });
        } catch {
          setStatus("failed");
        }
        reset.current = setTimeout(() => setStatus("idle"), 2000);
      }}
    >
      <span aria-live="polite">
        {status === "copied"
          ? "Badge Markdown copied"
          : status === "failed"
            ? "Copy failed. Try again."
            : "Add a badge to your README"}
      </span>
    </button>
  );
}
