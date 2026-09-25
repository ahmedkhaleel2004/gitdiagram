import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrowseTabs } from "~/components/browse-tabs";
import { VideoCatalog } from "~/components/explainer/video-catalog";
import { SITE_URL } from "~/lib/site";
import { getVideoCatalog } from "~/server/explainer/catalog";
import { isVideoExplainerEnabled } from "~/server/explainer/config";

const title = "Watch Repos Explained in a Minute | GitDiagram";
const description =
  "Narrated one-minute video tours of GitHub repositories: what each project does, how its parts fit together, and a few of the decisions inside.";

// The site's own preview images (app/opengraph-image.png and
// app/twitter-image.png): setting openGraph here would otherwise drop them.
const image = (path: string) => ({
  url: path,
  width: 1200,
  height: 630,
  alt: "GitDiagram",
});

// Its own link preview, so a shared /videos link does not read as the homepage.
export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/videos" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: `${SITE_URL}/videos`,
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

// The catalog is cached for five minutes; new videos appear within that.
export const revalidate = 300;

export default async function VideosIndexPage() {
  if (!isVideoExplainerEnabled()) notFound();
  const cards = await getVideoCatalog().catch(() => []);
  return (
    <main className="px-4 pt-5 pb-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <section className="mb-6 max-w-3xl sm:mb-9">
          <BrowseTabs active="videos" />
          <h1 className="text-4xl leading-[1.05] font-bold tracking-tight text-balance sm:text-5xl">
            Repos, explained in a minute
          </h1>
          <p className="mt-3 max-w-[36rem] text-base leading-relaxed text-pretty text-[hsl(var(--neo-soft-text))] sm:leading-normal dark:text-neutral-300">
            Narrated one-minute tours: what a project does, how its parts fit
            together, and a few of the decisions inside.
          </p>
        </section>
        <VideoCatalog cards={cards} />
      </div>
    </main>
  );
}
