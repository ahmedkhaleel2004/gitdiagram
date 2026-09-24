"use client";

import { useEffect, useRef, useState } from "react";
import { Clapperboard } from "lucide-react";
import {
  fetchExplainerVideo,
  streamExplainerVideo,
} from "~/features/explainer/api";
import type {
  VideoArtifact,
  VideoGenerationStage,
} from "~/features/explainer/types";
import controls from "~/components/generation/workspace.module.css";
import { ExplainerPlayer } from "./explainer-player";
import { ExplainerShare } from "./explainer-share";
import styles from "./explainer-video.module.css";

const STAGES: Array<{ id: VideoGenerationStage; label: string }> = [
  { id: "reading", label: "Reading the code" },
  { id: "planning", label: "Writing the script" },
  { id: "designing", label: "Designing scenes and recording the voice" },
  { id: "saving", label: "Saving" },
];

// A stored video belongs to everyone; only local development can replace one.
const CAN_REGENERATE = process.env.NODE_ENV === "development";

type PanelState =
  | { kind: "loading" }
  | { kind: "empty"; canGenerate: boolean }
  | { kind: "generating"; stage: VideoGenerationStage; startedAt: number }
  | { kind: "ready"; video: VideoArtifact; canGenerate: boolean }
  | { kind: "error"; message: string; canGenerate: boolean };

export function ExplainerVideo({
  username,
  repo,
}: {
  username: string;
  repo: string;
}) {
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const running = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchExplainerVideo(username, repo, controller.signal)
      .then(({ video, canGenerate }) =>
        setState(
          video
            ? { kind: "ready", video, canGenerate }
            : { kind: "empty", canGenerate },
        ),
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "Could not load the video.",
          canGenerate: false,
        });
      });
    return () => {
      controller.abort();
      running.current?.abort();
    };
  }, [username, repo]);

  useEffect(() => {
    if (state.kind !== "generating") return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [state.kind]);

  const generate = () => {
    const controller = new AbortController();
    running.current = controller;
    const startedAt = Date.now();
    setNow(startedAt);
    setState({ kind: "generating", stage: "reading", startedAt });
    streamExplainerVideo(
      username,
      repo,
      (event) => {
        if (event.status === "complete")
          setState({ kind: "ready", video: event.artifact, canGenerate: true });
        else if (event.status === "error")
          setState({ kind: "error", message: event.error, canGenerate: true });
        else setState({ kind: "generating", stage: event.status, startedAt });
      },
      controller.signal,
    ).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setState({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Video generation failed.",
        canGenerate: true,
      });
    });
  };

  if (state.kind === "loading")
    return <div className={styles.panel} aria-busy="true" />;

  if (state.kind === "ready") {
    const { video } = state;
    const cost = video.stats.plannerCostUsd;
    return (
      <div className={styles.panel}>
        <ExplainerPlayer key={video.createdAt} artifact={video} />
        <div className={styles.meta}>
          <span>
            {video.plan.beats.length} scenes ·{" "}
            {Math.round(video.timing.DURATION)}s
          </span>
          <span>
            Made in {(video.stats.totalMs / 1000).toFixed(0)}s
            {cost !== null ? ` · $${cost.toFixed(2)} model` : ""}
          </span>
          {CAN_REGENERATE && (
            <button
              type="button"
              className={styles.metaButton}
              onClick={generate}
            >
              Regenerate video
            </button>
          )}
        </div>
        <ExplainerShare video={video} />
      </div>
    );
  }

  if (state.kind === "generating") {
    const current = STAGES.findIndex((stage) => stage.id === state.stage);
    return (
      <div className={styles.panel}>
        <div className={styles.empty} aria-live="polite">
          <div className={styles.emptyTitle}>
            Making your explainer… {Math.floor((now - state.startedAt) / 1000)}s
          </div>
          <div className={styles.steps}>
            {STAGES.map((stage, index) => (
              <span
                key={stage.id}
                className={styles.step}
                data-state={
                  index < current
                    ? "done"
                    : index === current
                      ? "active"
                      : "todo"
                }
              >
                {stage.label}
              </span>
            ))}
          </div>
          <div className={styles.emptyText}>
            Claude reads the code, writes the script and designs every scene.
            This usually takes under a minute.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.empty}>
        <div className={styles.emptyTitle}>{repo}, in about a minute</div>
        <div className={styles.emptyText}>
          A narrated one-minute tour: what the project does, how its parts fit
          together, and a few of the decisions inside.
        </div>
        {state.kind === "error" && (
          <div className={styles.error}>{state.message}</div>
        )}
        {state.canGenerate ? (
          <button
            type="button"
            className={`${controls.actionButton} ${controls.primary}`}
            onClick={generate}
          >
            <Clapperboard size={15} aria-hidden="true" />
            {state.kind === "error" ? "Try again" : "Make the video"}
          </button>
        ) : (
          <div className={styles.emptyText}>
            Making new videos is paused for today. Check back tomorrow.
          </div>
        )}
      </div>
    </div>
  );
}
