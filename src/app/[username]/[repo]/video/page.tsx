import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { notFound, permanentRedirect } from "next/navigation";
import { SITE_URL } from "~/lib/site";
import { isVideoExplainerEnabled } from "~/server/explainer/config";
import { hasRender, readVideoArtifact } from "~/server/explainer/store";
import WatchPageClient from "./watch-page-client";

type WatchPageProps = {
  params: Promise<{ username: string; repo: string }>;
};

// A stored video changes only when the operator regenerates it.
export const revalidate = 300;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

/** What the page and its link preview need to know about a repo's video. */
function getVideoSummary(username: string, repo: string) {
  return unstable_cache(
    async () => {
      const video = await readVideoArtifact(username, repo);
      if (!video) return null;
      const [poster, mp4] = await Promise.all([
        hasRender(video, "poster.jpg"),
        hasRender(video, "landscape.mp4"),
      ]);
      return {
        createdAt: video.createdAt,
        owner: video.meta.owner,
        repo: video.meta.repo,
        // The opening lines say what the project is; they make the description.
        opening: video.plan.beats
          .slice(0, 2)
          .map((beat) => beat.narration)
          .join(" "),
        poster,
        mp4,
      };
    },
    ["explainer-video-summary", username.toLowerCase(), repo.toLowerCase()],
    { revalidate },
  )();
}

export async function generateMetadata({
  params,
}: WatchPageProps): Promise<Metadata> {
  const { username, repo } = await params;
  const path = `/${username.toLowerCase()}/${repo.toLowerCase()}/video`;
  const summary = isVideoExplainerEnabled()
    ? await getVideoSummary(username, repo).catch(() => null)
    : null;
  const title = `${username}/${repo}, explained in a minute | GitDiagram`;
  const description =
    summary?.opening ||
    `A narrated one-minute video tour of ${username}/${repo}: what it does and how it works.`;
  const file = (format: "poster" | "landscape") =>
    summary
      ? `${SITE_URL}/api/video/file?${new URLSearchParams({
          username: summary.owner,
          repo: summary.repo,
          format,
          v: summary.createdAt,
        }).toString()}`
      : "";
  const image = summary?.poster
    ? {
        url: file("poster"),
        width: 1200,
        height: 675,
        alt: `${username}/${repo} video tour`,
      }
    : {
        url: `${SITE_URL}/${username.toLowerCase()}/${repo.toLowerCase()}/opengraph-image`,
        width: 1200,
        height: 630,
        alt: "GitDiagram repository preview",
      };

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}${path}`,
      siteName: "GitDiagram",
      type: "video.other",
      images: [image],
      ...(summary?.mp4
        ? {
            videos: [
              {
                url: file("landscape"),
                type: "video/mp4",
                width: 1280,
                height: 720,
              },
            ],
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      creator: "@ahmedkhaleel2004",
      images: [image],
    },
  };
}

export default async function WatchPage({ params }: WatchPageProps) {
  if (!isVideoExplainerEnabled()) notFound();
  const { username, repo } = await params;
  if (username !== username.toLowerCase() || repo !== repo.toLowerCase())
    permanentRedirect(`/${username.toLowerCase()}/${repo.toLowerCase()}/video`);
  return <WatchPageClient username={username} repo={repo} />;
}
