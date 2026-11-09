import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "~/components/json-ld";
import {
  POPULAR,
  POPULAR_DESCRIPTION,
  POPULAR_META_TITLE,
  POPULAR_PATH,
  POPULAR_TITLE,
  POPULAR_URL,
  formatStars,
  popularIntro,
  repositoryPath,
} from "~/features/popular-repos/content";
import { SITE_URL } from "~/lib/site";

// A crawlable index of the diagrams of the most-starred GitHub repositories.
// Standalone: reached from search, the sitemap, /llms.txt and the data report.

export const metadata: Metadata = {
  title: POPULAR_META_TITLE,
  description: POPULAR_DESCRIPTION,
  alternates: {
    canonical: POPULAR_PATH,
    types: { "text/markdown": `${POPULAR_PATH}.md` },
  },
  openGraph: {
    title: POPULAR_TITLE,
    description: POPULAR_DESCRIPTION,
    url: POPULAR_URL,
    siteName: "GitDiagram",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: POPULAR_TITLE,
    description: POPULAR_DESCRIPTION,
  },
};

const linkClass = "neo-link font-medium hover:underline";

function popularJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${POPULAR_URL}#page`,
        name: POPULAR_TITLE,
        description: POPULAR_DESCRIPTION,
        url: POPULAR_URL,
        inLanguage: "en",
        dateModified: POPULAR.checked,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        mainEntity: { "@id": `${POPULAR_URL}#list` },
      },
      {
        "@type": "ItemList",
        "@id": `${POPULAR_URL}#list`,
        name: POPULAR_TITLE,
        itemListOrder: "https://schema.org/ItemListOrderDescending",
        numberOfItems: POPULAR.entries.length,
        // The first hundred: enough to say what the list is without
        // doubling the page's size.
        itemListElement: POPULAR.entries.slice(0, 100).map((entry, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: `${entry.repository} architecture diagram`,
          url: `${SITE_URL}${repositoryPath(entry.repository)}`,
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "GitDiagram",
            item: SITE_URL,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Most-starred repositories",
            item: POPULAR_URL,
          },
        ],
      },
    ],
  };
}

export default function MostStarredRepositoriesPage() {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-12 text-black sm:px-6 dark:text-neutral-100">
      <JsonLd data={popularJsonLd()} />
      <article>
        <h1 className="text-3xl font-bold text-balance">{POPULAR_TITLE}</h1>
        <p className="mt-6 leading-relaxed">{popularIntro()}</p>
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
          Also:{" "}
          <Link href="/open-source-architecture-2026" className={linkClass}>
            what these diagrams show across the top 1,000
          </Link>{" "}
          ·{" "}
          <Link href="/browse" className={linkClass}>
            every diagram
          </Link>{" "}
          ·{" "}
          <a href={`${POPULAR_PATH}.md`} className={linkClass}>
            Markdown
          </a>
        </p>
        <ol className="mt-8 space-y-4">
          {POPULAR.entries.map((entry, index) => (
            <li
              key={entry.repository}
              className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2"
            >
              <span className="pt-px text-right text-sm text-neutral-500 tabular-nums">
                {index + 1}.
              </span>
              <div className="min-w-0">
                <Link
                  href={repositoryPath(entry.repository)}
                  className={`${linkClass} break-words`}
                >
                  {entry.repository}
                </Link>{" "}
                <span className="text-sm text-neutral-600 dark:text-neutral-400">
                  {formatStars(entry.stars)} stars
                  {entry.language ? ` · ${entry.language}` : ""}
                </span>
                {entry.summary && (
                  <p className="mt-0.5 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
                    {entry.summary}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </article>
    </main>
  );
}
