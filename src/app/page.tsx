import type { Metadata } from "next";
import Link from "next/link";
import MainCard from "~/components/main-card";
import Hero from "~/components/hero";
import { JsonLd } from "~/components/json-ld";
import { NewBadge } from "~/components/new-badge";
import { GITHUB_REPO_URL, SITE_URL } from "~/lib/site";
import { cn } from "~/lib/utils";
import { VIDEOS_ENABLED } from "~/lib/video-flag";

// The server-rendered parts (the header's star count, which sponsor campaign
// is scheduled) refresh every five minutes instead of freezing at build time.
export const revalidate = 300;

const HOME_DESCRIPTION = VIDEOS_ENABLED
  ? "Turn any GitHub repository into an interactive architecture diagram or a one-minute explainer video for quick codebase understanding."
  : "Turn any GitHub repository into an interactive architecture diagram for quick codebase understanding.";

export const metadata: Metadata = {
  title: "GitDiagram - Visualize Any GitHub Repository",
  description: HOME_DESCRIPTION,
  alternates: {
    canonical: "/",
  },
};

/** schema.org: the site as a free web application, and how to use it. */
const applicationJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#app`,
      name: "GitDiagram",
      url: SITE_URL,
      description: `${HOME_DESCRIPTION} Replace "hub" with "diagram" in any GitHub URL (github.com/owner/repo becomes gitdiagram.com/owner/repo) to open the repository's diagram.`,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Any (web browser)",
      browserRequirements: "Requires JavaScript.",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      featureList: [
        "Interactive architecture diagram of any GitHub repository",
        "Components link to their source files on GitHub",
        "Export as PNG or Mermaid",
        "Private repositories with your own GitHub token",
        ...(VIDEOS_ENABLED ? ["Narrated one-minute explainer videos"] : []),
        "Markdown for AI agents at gitdiagram.com/owner/repo.md",
      ],
      sameAs: [GITHUB_REPO_URL],
      creator: {
        "@type": "Person",
        name: "Ahmed Khaleel",
        url: "https://ahmedkhaleel.com",
      },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: "GitDiagram",
      url: SITE_URL,
    },
  ],
};

export default function HomePage() {
  return (
    // Clipped sideways at the screen's edge: the banner's glow reaches past it
    // on narrow phones and would otherwise let the page scroll sideways.
    <main className="flex min-h-[calc(100svh-9.75rem)] flex-col justify-center overflow-x-clip px-4 pt-6 pb-3 sm:block sm:min-h-0 sm:px-8 sm:py-8 md:p-8">
      <JsonLd data={applicationJsonLd} />
      {/* The banner borrows its room from the surrounding gaps so the page
          still fits one screen. */}
      <div
        className={cn(
          "mx-auto max-w-4xl pt-9 sm:mb-4 sm:pt-0",
          VIDEOS_ENABLED ? "mb-3 lg:mt-0 lg:mb-5" : "mb-5 lg:my-8",
        )}
      >
        {VIDEOS_ENABLED && (
          <div className="-mt-10 mb-[5rem] flex justify-center max-[389px]:mb-[4.25rem] sm:mt-0 sm:mb-8 lg:mb-4">
            <div className="promo-banner relative isolate">
              <span aria-hidden="true" className="promo-banner-glow" />
              <Link
                href="/videos"
                className="browse-muted-button inline-flex min-h-[40px] max-w-full items-center gap-2.5 rounded-full py-1.5 pr-4 pl-2 text-sm font-semibold whitespace-nowrap max-[389px]:gap-2 max-[389px]:pr-3 max-[389px]:text-[0.8125rem]"
              >
                <NewBadge />
                {/* The full line needs ~330px; the smallest phones get a shorter one. */}
                <span className="max-[359px]:hidden">
                  Watch any repo explained in a minute
                </span>
                <span className="hidden max-[359px]:inline">
                  Repos explained in a minute
                </span>
                <span aria-hidden="true" className="promo-banner-arrow">
                  →
                </span>
              </Link>
            </div>
          </div>
        )}
        <Hero />
        <div
          className={cn(
            "mx-auto max-w-[22rem] space-y-2 text-center text-[1.0625rem] leading-6 text-balance text-[hsl(var(--neo-soft-text))] sm:mt-12 sm:max-w-2xl sm:text-lg sm:leading-normal",
            VIDEOS_ENABLED ? "mt-4 lg:mt-9" : "mt-5",
          )}
        >
          <p>
            {VIDEOS_ENABLED
              ? "Turn any GitHub repository into an interactive diagram or explainer video."
              : "Turn any GitHub repository into an interactive diagram for visualization."}
          </p>
          <p className="hidden sm:block">
            Or, replace &apos;hub&apos; with &apos;diagram&apos; in any GitHub
            URL.
          </p>
        </div>
      </div>
      <div className="flex justify-center sm:mb-16 lg:mb-0">
        <MainCard />
      </div>
    </main>
  );
}
