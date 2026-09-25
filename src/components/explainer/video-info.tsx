"use client";

import { useEffect, useState } from "react";
import { fetchExplainerVideo } from "~/features/explainer/api";
import { modelLabel } from "~/features/explainer/model-label";
import { useVideoRun } from "~/features/explainer/runs";
import styles from "~/components/generation/workspace.module.css";

// The model each repository's video was made with, looked up once per page.
const looked = new Map<string, Promise<string | null>>();

function storedModel(username: string, repo: string) {
  const key = `${username}/${repo}`.toLowerCase();
  let model = looked.get(key);
  if (!model) {
    model = fetchExplainerVideo(username, repo)
      .then((state) => state.video?.stats.model ?? null)
      .catch(() => {
        looked.delete(key);
        return null;
      });
    looked.set(key, model);
  }
  return model;
}

/** A line in the Info panel naming the model that made this repository's video. */
export function VideoInfo({
  username,
  repo,
}: {
  username: string;
  repo: string;
}) {
  const run = useVideoRun(username, repo);
  const [stored, setStored] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void storedModel(username, repo).then((model) => {
      if (current) setStored(model);
    });
    return () => {
      current = false;
    };
  }, [username, repo]);
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
