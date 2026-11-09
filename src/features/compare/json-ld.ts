import { guidePlainText, type GuideQuestion } from "~/features/guide/content";
import { SITE_URL } from "~/lib/site";
import { COMPARE_CHECKED } from "./content";

/**
 * TechArticle + FAQPage + BreadcrumbList for a comparison page (and, with
 * `date` and `extra`, for a situation guide).
 */
export function compareJsonLd({
  path,
  headline,
  description,
  sections,
  questions,
  about,
  breadcrumbs,
  date = COMPARE_CHECKED,
  extra = [],
}: {
  path: string;
  headline: string;
  description: string;
  sections: string[];
  questions: GuideQuestion[];
  /** The products the page is about, by name. */
  about: string[];
  breadcrumbs: Array<{ name: string; path: string }>;
  /** When the page's facts were checked (published and modified). */
  date?: string;
  /** More nodes for the graph, such as a HowTo. */
  extra?: Array<Record<string, unknown>>;
}) {
  const url = `${SITE_URL}${path}`;
  const publisher = {
    "@type": "Organization",
    name: "GitDiagram",
    url: SITE_URL,
  };
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TechArticle",
        "@id": `${url}#article`,
        headline,
        description,
        url,
        mainEntityOfPage: url,
        inLanguage: "en",
        datePublished: date,
        dateModified: date,
        author: publisher,
        publisher,
        about: about.map((name) => ({ "@type": "SoftwareApplication", name })),
        articleSection: sections,
      },
      ...(questions.length
        ? [
            {
              "@type": "FAQPage",
              "@id": `${url}#faq`,
              mainEntity: questions.map(({ question, answer }) => ({
                "@type": "Question",
                name: question,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: guidePlainText(answer),
                },
              })),
            },
          ]
        : []),
      ...extra,
      {
        "@type": "BreadcrumbList",
        itemListElement: [{ name: "GitDiagram", path: "" }, ...breadcrumbs].map(
          (crumb, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: crumb.name,
            item: `${SITE_URL}${crumb.path}`,
          }),
        ),
      },
    ],
  };
}
