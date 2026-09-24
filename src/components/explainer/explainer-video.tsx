"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleAlert, Clapperboard } from "lucide-react";
import {
  fetchExplainerVideo,
  streamExplainerVideo,
} from "~/features/explainer/api";
import type {
  VideoArtifact,
  VideoGenerationProgress,
  VideoGenerationStage,
} from "~/features/explainer/types";
import { ActivityMark } from "~/components/generation/activity-mark";
import { useGenerationClock } from "~/components/generation/generation-status";
import controls from "~/components/generation/workspace.module.css";
import { ExplainerPlayer } from "./explainer-player";
import { GenerationRows, ScriptPreview } from "./explainer-progress";
import { ExplainerShare } from "./explainer-share";
import styles from "./explainer-video.module.css";

const STAGE_TITLES: Record<VideoGenerationStage, string> = {
  reading: "Reading the code",
  planning: "Writing the script",
  designing: "Designing the scenes and recording the voice",
  saving: "Saving the video",
};

function isTouchMac() {
  return navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent);
}

const PAUSED: Record<"audience" | "limit", string> = {
  audience:
    "Making new videos is in early access in a few places for now. Every video already made is free to watch.",
  limit:
    "Today's free videos have all been made. Check back tomorrow; every video already made is free to watch.",
};

// A stored video belongs to everyone; only local development can replace one.
const CAN_REGENERATE = process.env.NODE_ENV === "development";

type PanelState =
  | { kind: "loading" }
  | {
      kind: "empty";
      canGenerate: boolean;
      paused: "audience" | "limit" | null;
    }
  | {
      kind: "generating";
      stage: VideoGenerationStage;
      startedAt: number;
      progress: VideoGenerationProgress;
    }
  | { kind: "ready"; video: VideoArtifact }
  | { kind: "error"; message: string; canGenerate: boolean };

function Elapsed({ startedAt }: { startedAt: number }) {
  const { seconds } = useGenerationClock({
    running: true,
    paused: false,
    startedAt,
  });
  return (
    <span
      className={controls.elapsed}
      aria-label={`${seconds} seconds elapsed`}
    >
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

/** A player-shaped placeholder while the stored video is looked up. */
function PlayerSkeleton() {
  return (
    <div className={styles.panel} aria-busy="true">
      <div className={`${styles.player} ${styles.skeleton}`}>
        <div className={styles.skeletonLabel}>
          <ActivityMark />
          <span className={styles.shimmer}>Loading video</span>
        </div>
      </div>
    </div>
  );
}

export function ExplainerVideo({
  username,
  repo,
}: {
  username: string;
  repo: string;
}) {
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const running = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchExplainerVideo(username, repo, controller.signal)
      .then(({ video, canGenerate, paused }) =>
        setState(
          video
            ? { kind: "ready", video }
            : // iPads report a desktop Mac to the server; early access is for desktops.
              isTouchMac()
              ? { kind: "empty", canGenerate: false, paused: "audience" }
              : { kind: "empty", canGenerate, paused },
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

  const generate = () => {
    const controller = new AbortController();
    running.current = controller;
    const startedAt = Date.now();
    let progress: VideoGenerationProgress = {};
    setState({ kind: "generating", stage: "reading", startedAt, progress });
    streamExplainerVideo(
      username,
      repo,
      (event) => {
        if (event.status === "complete")
          setState({ kind: "ready", video: event.artifact });
        else if (event.status === "error")
          setState({ kind: "error", message: event.error, canGenerate: true });
        else {
          progress = { ...progress, ...event.progress };
          setState({
            kind: "generating",
            stage: event.status,
            startedAt,
            progress,
          });
        }
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

  if (state.kind === "loading") return <PlayerSkeleton />;

  if (state.kind === "ready") {
    const { video } = state;
    const cost = video.stats.plannerCostUsd;
    return (
      <div className={`${styles.panel} ${styles.enter}`}>
        <ExplainerPlayer key={video.createdAt} artifact={video} />
        <div className={styles.meta}>
          <span>
            {new Set(video.plan.beats.map((beat) => beat.scene)).size} scenes ·{" "}
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

  if (state.kind === "generating")
    return (
      <div className={`${controls.feedback} ${styles.enter}`}>
        <div className={controls.statusLine}>
          <ActivityMark />
          <h2
            className={`${controls.statusTitle} ${styles.shimmer}`}
            aria-live="polite"
            aria-atomic="true"
          >
            {STAGE_TITLES[state.stage]}
          </h2>
          <Elapsed startedAt={state.startedAt} />
        </div>
        <p className={controls.description}>
          Claude reads {repo}, writes a script and designs every scene while the
          narration is recorded. Usually under a minute.
        </p>
        <div className={styles.progressBody}>
          <GenerationRows stage={state.stage} progress={state.progress} />
          {state.progress.narration && (
            <ScriptPreview lines={state.progress.narration} />
          )}
        </div>
      </div>
    );

  const failed = state.kind === "error";
  const paused = !failed && !state.canGenerate;
  return (
    <div className={`${controls.feedback} ${styles.enter}`}>
      <div className={controls.statusLine}>
        {failed ? (
          <CircleAlert size={17} aria-hidden="true" />
        ) : (
          <Clapperboard size={17} aria-hidden="true" />
        )}
        <h2
          className={controls.statusTitle}
          role={failed ? "alert" : undefined}
        >
          {failed ? state.message : `There's no video of ${repo} yet`}
        </h2>
      </div>
      {!failed && (
        <p className={controls.description}>
          {paused
            ? PAUSED[state.paused ?? "limit"]
            : "A narrated one-minute tour: what the project does, how its parts fit together, and a few of the decisions inside."}
        </p>
      )}
      <div className={styles.cta}>
        {paused ? (
          <Link
            href="/watch"
            className={`${controls.actionButton} ${controls.primary}`}
          >
            <Clapperboard size={15} aria-hidden="true" />
            Watch the videos
          </Link>
        ) : (
          (state.canGenerate || failed) && (
            <button
              type="button"
              className={`${controls.actionButton} ${controls.primary}`}
              onClick={generate}
            >
              <Clapperboard size={15} aria-hidden="true" />
              {failed ? "Try again" : "Make the video"}
            </button>
          )
        )}
      </div>
    </div>
  );
}
