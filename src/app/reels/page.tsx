import type { Metadata, Viewport } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { notFound } from "next/navigation";
import { ReelsFeed } from "~/components/explainer/reels/reels-feed";
import { shuffled } from "~/features/explainer/reels";
import {
  VIDEO_PAGE_SIZE,
  type VideoPage,
} from "~/features/explainer/catalog-types";
import { SITE_URL } from "~/lib/site";
import { getVideoPage } from "~/server/explainer/catalog";
import { isVideoExplainerEnabled } from "~/server/explainer/config";
import { errorText, logEvent } from "~/server/log";

const title = "GitHub Reels | GitDiagram";
const description =
  "Swipe through one-minute video tours of GitHub's biggest repositories.";

const image = (path: string) => ({
  url: path,
  width: 1200,
  height: 630,
  alt: "GitDiagram",
});

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/reels" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: `${SITE_URL}/reels`,
    title,
    description,
    siteName: "GitDiagram",
    images: [image("/opengraph-image.png")],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    creator: "@ahmedkhaleel2004",
    images: [image("/twitter-image.png")],
  },
};

// The feed reaches under the notch and the home bar; its own layout keeps
// its text and buttons clear of them.
export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: "#f2e8ff",
};

// A fresh shuffle of the most-starred videos every five minutes.
export const revalidate = 300;

/**
 * The most-starred videos. As on /videos, a failed read throws (so the last
 * good feed keeps being served) except during a build, which gets an empty
 * feed rather than failing over a brief storage error.
 */
async function firstPage(): Promise<VideoPage> {
  try {
    return await getVideoPage({ sort: "stars_desc" });
  } catch (error) {
    if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) throw error;
    logEvent("warn", "video.reels_build_fallback", {
      error: errorText(error),
    });
    return {
      cards: [],
      total: 0,
      page: 1,
      pageSize: VIDEO_PAGE_SIZE,
      totalPages: 1,
      sort: "stars_desc",
      q: "",
      minStars: 0,
    };
  }
}

export default async function ReelsPage() {
  if (!isVideoExplainerEnabled()) notFound();
  const page = await firstPage();
  return <ReelsFeed initial={{ ...page, cards: shuffled(page.cards) }} />;
}
