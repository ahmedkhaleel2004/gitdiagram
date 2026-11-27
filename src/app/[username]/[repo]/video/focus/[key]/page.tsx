import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isVideoExplainerEnabled } from "~/server/explainer/config";
import { FOCUS_KEY } from "~/server/explainer/focus";
import {
  publicVideoArtifact,
  readVideoArtifact,
} from "~/server/explainer/store";
import VideoWatchPageClient from "../../video-watch-page-client";

type FocusedVideoPageProps = {
  params: Promise<{ username: string; repo: string; key: string }>;
};

// A focused film (focus.ts) follows one part of a repository, made by the
// operator. Its page is its own, so the repository's watch page and its cache
// stay exactly as they were; it is never indexed, listed or in the sitemap.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: FocusedVideoPageProps): Promise<Metadata> {
  const { username, repo } = await params;
  return {
    title: `${username}/${repo}, one part explained | GitDiagram`,
    robots: { index: false, follow: false },
  };
}

export default async function FocusedVideoPage({
  params,
}: FocusedVideoPageProps) {
  if (!isVideoExplainerEnabled()) notFound();
  const { username, repo, key } = await params;
  if (!FOCUS_KEY.test(key)) notFound();
  const video = await readVideoArtifact(username, repo, key);
  if (!video) notFound();
  return (
    <VideoWatchPageClient
      username={username}
      repo={repo}
      video={publicVideoArtifact(video)}
    />
  );
}
