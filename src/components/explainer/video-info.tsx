"use client";

import { modelLabel } from "~/features/explainer/model-label";
import { useVideoRun } from "~/features/explainer/runs";
import { useStoredVideoModel } from "~/features/explainer/stored-video";
import styles from "~/components/generation/workspace.module.css";

/** A line in the Info panel naming the model that made this repository's video. */
export function VideoInfo({
  username,
  repo,
}: {
  username: string;
  repo: string;
}) {
  const run = useVideoRun(username, repo);
  // Shared with the Video panel's lookups, and updated when a run finishes.
  const stored = useStoredVideoModel(username, repo);
  const making = run?.kind === "generating" ? run.progress.model : undefined;
  const model =
    making ?? (run?.kind === "ready" ? run.video.stats.model : stored);
  if (!model) return null;
  return (
    <div className={styles.resultMetadata}>
      <span>
        Video {making ? "being made" : "made"} with {modelLabel(model)}
      </span>
    </div>
  );
}
