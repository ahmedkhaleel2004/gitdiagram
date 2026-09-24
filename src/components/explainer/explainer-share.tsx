"use client";

import { useState } from "react";
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
  watchPath,
  type RenderFormat,
} from "~/features/explainer/api";
import type { VideoArtifact } from "~/features/explainer/types";
import controls from "~/components/generation/workspace.module.css";
import { JobRow } from "./explainer-progress";
import styles from "./explainer-video.module.css";

type Copied = "link" | "badge" | null;

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
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<Copied>(null);
  const url = `${window.location.origin}${watchPath(owner, repo)}`;
  const canShare = typeof navigator.share === "function";

  const download = async (format: RenderFormat) => {
    setError(null);
    setJob({ format, progress: 0 });
    let finished = false;
    try {
      await streamExplainerRender(owner, repo, format, (event) => {
        if (event.status === "rendering")
          setJob({ format, progress: event.progress });
        else if (event.status === "complete") finished = true;
        else throw new Error(event.error);
      });
      if (!finished) throw new Error("The MP4 could not be made. Try again.");
      triggerDownload(renderFileUrl(video, format));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The MP4 could not be made. Try again.",
      );
    } finally {
      setJob(null);
    }
  };

  const copy = async (text: string, what: Exclude<Copied, null>) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1800);
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
          disabled={job !== null}
          aria-live="polite"
        >
          <Download size={15} aria-hidden="true" />
          {label("landscape", "Download MP4")}
        </button>
        <button
          type="button"
          className={controls.actionButton}
          onClick={() => void download("vertical")}
          disabled={job !== null}
          aria-live="polite"
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
      {job && (
        <div className={styles.shareJob}>
          <JobRow
            label={`Rendering the ${job.format === "vertical" ? "9:16" : "16:9"} MP4 with captions`}
            fraction={job.progress}
          />
          <div className={styles.shareNote}>
            Only the first download renders; after that it is instant for
            everyone.
          </div>
        </div>
      )}
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
