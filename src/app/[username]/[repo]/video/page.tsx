import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { notFound, permanentRedirect } from "next/navigation";
import { videoFileUrl } from "~/features/explainer/file-url";
import { SITE_URL } from "~/lib/site";
import { videoSummaryTag } from "~/server/explainer/cache";
import { isVideoExplainerEnabled } from "~/server/explainer/config";
import {
  hasRender,
  readVideoArtifact,
  renderStamp,
} from "~/server/explainer/store";
import VideoWatchPageClient from "./video-watch-page-client";

type VideoWatchPageProps = {
  params: Promise<{ username: string; repo: string }>;
};

// A stored video changes only when the operator regenerates it, and that
// refreshes this page at once (see refreshVideoPages).
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
        // When the poster was made (or null): its URL carries it, so a
        // remade poster is not hidden behind the old one's cache.
        renderStamp(video, "poster.jpg"),
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
        seconds: Math.round(video.timing.DURATION),
        poster,
        mp4,
      };
    },
    ["explainer-video-summary", username.toLowerCase(), repo.toLowerCase()],
    { revalidate, tags: [videoSummaryTag(username, repo)] },
  )();
}

type VideoSummary = NonNullable<Awaited<ReturnType<typeof getVideoSummary>>>;

function readSummary(username: string, repo: string) {
  return isVideoExplainerEnabled()
    ? getVideoSummary(username, repo).catch(() => null)
    : Promise.resolve(null);
}

const watchPath = (username: string, repo: string) =>
  `/${username.toLowerCase()}/${repo.toLowerCase()}/video`;

/** Absolute URLs of a video's stored poster and MP4 (null when not made yet). */
function summaryFiles(summary: VideoSummary) {
  const version = {
    owner: summary.owner,
    repo: summary.repo,
    createdAt: summary.createdAt,
    posterAt: typeof summary.poster === "number" ? summary.poster : null,
  };
  return {
    poster: summary.poster ? videoFileUrl(version, "poster", SITE_URL) : null,
    mp4: summary.mp4 ? videoFileUrl(version, "landscape", SITE_URL) : null,
  };
}

export async function generateMetadata({
  params,
}: VideoWatchPageProps): Promise<Metadata> {
  const { username, repo } = await params;
  const path = watchPath(username, repo);
  const summary = await readSummary(username, repo);
  const fallbackImage = {
    url: `${SITE_URL}/${username.toLowerCase()}/${repo.toLowerCase()}/opengraph-image`,
    width: 1200,
    height: 630,
    alt: "GitDiagram repository preview",
  };

  // No video yet: nothing to preview or index until one is made.
  if (!summary) {
    const title = `${username}/${repo} video tour | GitDiagram`;
    const description = `Watch or make a one-minute video tour of ${username}/${repo} on GitDiagram.`;
    return {
      title,
      description,
      alternates: { canonical: path },
      robots: { index: false, follow: true },
      openGraph: {
        title,
        description,
        url: `${SITE_URL}${path}`,
        siteName: "GitDiagram",
        type: "website",
        images: [fallbackImage],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        creator: "@ahmedkhaleel2004",
        images: [fallbackImage],
      },
    };
  }

  const title = `${username}/${repo}, explained in a minute | GitDiagram`;
  const description =
    summary.opening ||
    `A narrated one-minute video tour of ${username}/${repo}: what it does and how it works.`;
  const files = summaryFiles(summary);
  const image = files.poster
    ? {
        url: files.poster,
        width: 1200,
        height: 675,
        alt: `${username}/${repo} video tour`,
      }
    : fallbackImage;

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
      ...(files.mp4
        ? {
            videos: [
              {
                url: files.mp4,
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

/** schema.org VideoObject for a stored video, so search can list it as one. */
function videoJsonLd(username: string, repo: string, summary: VideoSummary) {
  const files = summaryFiles(summary);
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: `${username}/${repo}, explained in a minute`,
    description:
      summary.opening ||
      `A narrated one-minute video tour of ${username}/${repo}.`,
    thumbnailUrl: [
      files.poster ??
        `${SITE_URL}/${username.toLowerCase()}/${repo.toLowerCase()}/opengraph-image`,
    ],
    uploadDate: summary.createdAt,
    url: `${SITE_URL}${watchPath(username, repo)}`,
    // Summaries cached before `seconds` was recorded leave it out.
    ...(typeof summary.seconds === "number"
      ? { duration: `PT${summary.seconds}S` }
      : {}),
    ...(files.mp4 ? { contentUrl: files.mp4 } : {}),
  };
}

export default async function VideoWatchPage({ params }: VideoWatchPageProps) {
  if (!isVideoExplainerEnabled()) notFound();
  const { username, repo } = await params;
  if (username !== username.toLowerCase() || repo !== repo.toLowerCase())
    permanentRedirect(watchPath(username, repo));
  const summary = await readSummary(username, repo);
  return (
    <>
      {summary && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(
              videoJsonLd(username, repo, summary),
            ).replace(/</g, "\\u003c"),
          }}
        />
      )}
      <VideoWatchPageClient username={username} repo={repo} />
    </>
  );
}
