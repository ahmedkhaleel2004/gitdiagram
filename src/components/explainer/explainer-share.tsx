"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Download,
  Link2,
  Share2,
  Smartphone,
  Code2,
} from "lucide-react";
import {
  renderFileUrl,
  streamExplainerRender,
  VideoRequestError,
  watchPath,
  type RenderFormat,
} from "~/features/explainer/api";
import type {
  VideoArtifact,
  VideoRenderStep,
} from "~/features/explainer/types";
import controls from "~/components/generation/workspace.module.css";
import { JobRow } from "./explainer-progress";
import styles from "./explainer-video.module.css";

type Copied = "link" | "badge" | null;

const RENDER_FAILED = "The MP4 could not be made. Try again.";

function jobLabel(format: RenderFormat, step: VideoRenderStep) {
  if (step === "starting") return "Starting the renderer";
  if (step === "finishing") return "Adding the soundtrack";
  return `Rendering the ${format === "vertical" ? "9:16" : "16:9"} MP4 with captions`;
}

function triggerDownload(href: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Everything a viewer needs to pass a video on: the MP4 for feeds (landscape
 * and 9:16, captions burned in), the watch link, the phone's share sheet and a
 * README badge.
 */
export function ExplainerShare({ video }: { video: VideoArtifact }) {
  const { owner, repo } = video.meta;
  const [job, setJob] = useState<{
    format: RenderFormat;
    progress: number;
    step: VideoRenderStep;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The video was replaced after this page loaded; its MP4 is no longer made.
  const [stale, setStale] = useState(false);
  const [copied, setCopied] = useState<Copied>(null);
  const render = useRef<AbortController | null>(null);
  const copyTimer = useRef<number | undefined>(undefined);
  const url = `${window.location.origin}${watchPath(owner, repo)}`;
  const canShare = typeof navigator.share === "function";

  // Leaving the video stops waiting for its MP4 (and its download).
  useEffect(
    () => () => {
      render.current?.abort();
      window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const download = async (format: RenderFormat) => {
    const controller = new AbortController();
    render.current = controller;
    setError(null);
    setJob({ format, progress: 0, step: "starting" });
    let finished = false;
    try {
      await streamExplainerRender(
        owner,
        repo,
        format,
        video.createdAt,
        (event) => {
          if (event.status === "rendering")
            setJob({
              format,
              progress: event.progress,
              step: event.step ?? "rendering",
            });
          else if (event.status === "complete") finished = true;
          else throw new Error(event.error);
        },
        controller.signal,
      );
      if (!finished) throw new Error(RENDER_FAILED);
      if (!controller.signal.aborted)
        triggerDownload(renderFileUrl(video, format));
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (caught instanceof VideoRequestError && caught.stale) setStale(true);
      else setError(caught instanceof Error ? caught.message : RENDER_FAILED);
    } finally {
      if (!controller.signal.aborted) setJob(null);
      if (render.current === controller) render.current = null;
    }
  };

  const copy = async (text: string, what: Exclude<Copied, null>) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setError("Copying was blocked by the browser.");
    }
  };

  const badge = `[![Watch a one-minute video tour of ${repo}](${window.location.origin}/video-badge.svg)](${url})`;
  const label = (format: RenderFormat, idle: string) =>
    job?.format === format ? "Making MP4…" : idle;

  return (
    <div className={styles.share}>
      <div className={styles.shareRow}>
        <button
          type="button"
          className={`${controls.actionButton} ${controls.primary}`}
          onClick={() => void download("landscape")}
          disabled={job !== null || stale}
        >
          <Download size={15} aria-hidden="true" />
          {label("landscape", "Download MP4")}
        </button>
        <button
          type="button"
          className={controls.actionButton}
          onClick={() => void download("vertical")}
          disabled={job !== null || stale}
          title="9:16 for Shorts, Reels and TikTok"
        >
          <Smartphone size={15} aria-hidden="true" />
          {label("vertical", "Vertical MP4")}
        </button>
        {canShare ? (
          <button
            type="button"
            className={controls.actionButton}
            onClick={() =>
              void navigator
                .share({
                  title: `${owner}/${repo}, explained in a minute`,
                  url,
                })
                .catch(() => undefined)
            }
          >
            <Share2 size={15} aria-hidden="true" />
            Share
          </button>
        ) : (
          <button
            type="button"
            className={controls.actionButton}
            onClick={() => void copy(url, "link")}
          >
            {copied === "link" ? (
              <Check size={15} aria-hidden="true" />
            ) : (
              <Link2 size={15} aria-hidden="true" />
            )}
            {copied === "link" ? "Link copied" : "Copy link"}
          </button>
        )}
        <button
          type="button"
          className={controls.actionButton}
          onClick={() => void copy(badge, "badge")}
          title="Markdown for a README badge that opens this video"
        >
          {copied === "badge" ? (
            <Check size={15} aria-hidden="true" />
          ) : (
            <Code2 size={15} aria-hidden="true" />
          )}
          {copied === "badge" ? "Badge copied" : "README badge"}
        </button>
      </div>
      {/* Announces each step once; the percentage beside it is not read out. */}
      <span className="sr-only" role="status">
        {job ? jobLabel(job.format, job.step) : ""}
      </span>
      {job && (
        <div className={styles.shareJob}>
          <JobRow
            label={jobLabel(job.format, job.step)}
            fraction={job.progress}
          />
          <div className={styles.shareNote}>
            The first download takes about a minute; after that it is instant
            for everyone.
          </div>
        </div>
      )}
      {stale ? (
        <div className={styles.error} role="alert">
          This video was just updated.{" "}
          <button
            type="button"
            className={styles.metaButton}
            onClick={() => window.location.reload()}
          >
            Reload to get the new one
          </button>
        </div>
      ) : (
        error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )
      )}
    </div>
  );
}
