import type { Metadata } from "next";
import { SITE_URL } from "~/lib/site";

// Metadata for the guide and comparison articles. Setting `openGraph` on a
// page replaces the root's, which drops the site's share picture, so it is
// named again here (with the Twitter card's title and text).

const SHARE_IMAGE = {
  url: "/opengraph-image.png",
  width: 1200,
  height: 630,
  alt: "GitDiagram",
};

export function articleMetadata({
  path,
  title,
  headline,
  description,
}: {
  path: string;
  /** The <title>. */
  title: string;
  /** The article's heading, used as the share title. */
  headline: string;
  description: string;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: headline,
      description,
      url: `${SITE_URL}${path}`,
      siteName: "GitDiagram",
      type: "article",
      images: [SHARE_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: headline,
      description,
      images: [SHARE_IMAGE.url],
    },
  };
}
