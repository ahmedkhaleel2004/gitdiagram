"use client";

import type { GenerationCostSummary } from "~/features/diagram/cost";
import { useHydrated } from "~/hooks/use-hydrated";
import styles from "./workspace.module.css";

const generatedTimeFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// The browser's timezone is only known after hydration. Keep the server's
// reserved date space empty, then reveal the final local value once.
function localGeneratedTime(date: Date) {
  return generatedTimeFormatter.format(date);
}

export function DiagramMetadata({
  lastGenerated,
  cost,
}: {
  lastGenerated?: Date;
  cost?: GenerationCostSummary;
}) {
  const hydrated = useHydrated();
  if (!lastGenerated && !cost) return null;
  return (
    <div className={styles.resultMetadata}>
      {lastGenerated && (
        <span
          className={styles.generatedTime}
          data-hydrated={hydrated}
          aria-hidden={!hydrated}
        >
          Generated{" "}
          <time
            dateTime={lastGenerated.toISOString()}
            title={lastGenerated.toISOString()}
          >
            {hydrated ? localGeneratedTime(lastGenerated) : null}
          </time>
        </span>
      )}
      {cost && (
        <span>
          {cost.kind === "actual" ? "Actual" : "Estimated"} cost: {cost.display}
        </span>
      )}
    </div>
  );
}
