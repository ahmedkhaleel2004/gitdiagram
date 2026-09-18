"use client";

import type { GenerationCostSummary } from "~/features/diagram/cost";
import { useHydrated } from "~/hooks/use-hydrated";
import styles from "./workspace.module.css";

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
        <span>
          Generated{" "}
          <time
            dateTime={lastGenerated.toISOString()}
            title={lastGenerated.toISOString()}
          >
            {hydrated
              ? new Intl.DateTimeFormat("en", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                }).format(lastGenerated)
              : `${lastGenerated.toISOString().slice(0, 16).replace("T", " ")} UTC`}
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
