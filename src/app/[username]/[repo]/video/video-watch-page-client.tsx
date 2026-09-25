"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import controls from "~/components/generation/workspace.module.css";
import styles from "~/components/explainer/explainer-video.module.css";

const ExplainerVideo = dynamic(
  () =>
    import("~/components/explainer/explainer-video").then(
      (module) => module.ExplainerVideo,
    ),
  { ssr: false, loading: () => <div className={styles.panel} /> },
);

/**
 * The shareable page for a repository's video: the player, the ways to pass it
 * on, and the way into the full interactive diagram. It never starts a diagram
 * run, so shared links stay fast and cheap.
 */
export default function VideoWatchPageClient({
  username,
  repo,
}: {
  username: string;
  repo: string;
}) {
  return (
    <main className={`${controls.workspace} ${styles.watch}`}>
      <header className={styles.watchHead}>
        <h1 className={styles.watchTitle}>
          {username}/<strong>{repo}</strong>
        </h1>
        <p className={styles.watchSub}>explained in about a minute</p>
      </header>
      <ExplainerVideo username={username} repo={repo} />
      <nav
        className={styles.watchLinks}
        aria-label="More about this repository"
      >
        <Link
          href={`/${username}/${repo}`}
          className={`${controls.actionButton} ${controls.primary}`}
        >
          Open the interactive diagram
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
        <a
          href={`https://github.com/${username}/${repo}`}
          target="_blank"
          rel="noopener noreferrer"
          className={controls.actionButton}
        >
          <ExternalLink size={15} aria-hidden="true" />
          View on GitHub
        </a>
      </nav>
    </main>
  );
}
