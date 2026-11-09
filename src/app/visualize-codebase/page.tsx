import type { Metadata } from "next";
import { JsonLd } from "~/components/json-ld";
import { richText } from "~/features/guide/rich-text";
import {
  GUIDE_DESCRIPTION,
  GUIDE_INTRODUCTION,
  GUIDE_PATH,
  GUIDE_QUESTIONS,
  GUIDE_TITLE,
  GUIDE_UPDATED,
  guidePlainText,
  guideSections,
} from "~/features/guide/content";
import { SITE_URL } from "~/lib/site";
import { VIDEOS_ENABLED } from "~/lib/video-flag";

export const metadata: Metadata = {
  title: "How to Visualize a Codebase: GitHub Architecture Diagrams",
  description: GUIDE_DESCRIPTION,
  alternates: { canonical: GUIDE_PATH },
  openGraph: {
    title: GUIDE_TITLE,
    description: GUIDE_DESCRIPTION,
    url: `${SITE_URL}${GUIDE_PATH}`,
    siteName: "GitDiagram",
    type: "article",
  },
};

function guideJsonLd(videos: boolean) {
  const url = `${SITE_URL}${GUIDE_PATH}`;
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
        headline: GUIDE_TITLE,
        description: GUIDE_DESCRIPTION,
        url,
        mainEntityOfPage: url,
        inLanguage: "en",
        dateModified: GUIDE_UPDATED,
        author: publisher,
        publisher,
        articleSection: guideSections({ videos }).map(
          (section) => section.heading,
        ),
      },
      {
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        mainEntity: GUIDE_QUESTIONS.map(({ question, answer }) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: { "@type": "Answer", text: guidePlainText(answer) },
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
            name: "How to visualize a codebase",
            item: url,
          },
        ],
      },
    ],
  };
}

export default function VisualizeCodebasePage() {
  const sections = guideSections({ videos: VIDEOS_ENABLED });
  return (
    <main className="container mx-auto max-w-2xl px-6 py-12 text-black dark:text-neutral-100">
      <JsonLd data={guideJsonLd(VIDEOS_ENABLED)} />
      <article>
        <h1 className="text-3xl font-bold text-balance">{GUIDE_TITLE}</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Updated{" "}
          <time dateTime={GUIDE_UPDATED}>
            {new Date(GUIDE_UPDATED).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
              timeZone: "UTC",
            })}
          </time>
        </p>
        <p className="mt-6 leading-relaxed">{richText(GUIDE_INTRODUCTION)}</p>
        {sections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            aria-labelledby={`${section.id}-title`}
            className="mt-10 scroll-mt-8"
          >
            <h2 id={`${section.id}-title`} className="text-xl font-semibold">
              {section.heading}
            </h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="mt-3 leading-relaxed">
                {richText(paragraph)}
              </p>
            ))}
            {section.entries && (
              <dl className="mt-4 space-y-4">
                {section.entries.map((entry) => (
                  <div key={entry.name}>
                    <dt className="font-semibold">{entry.name}</dt>
                    <dd className="mt-1 leading-relaxed">
                      {richText(entry.text)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        ))}
        <section
          id="questions"
          aria-labelledby="questions-title"
          className="mt-10 scroll-mt-8"
        >
          <h2 id="questions-title" className="text-xl font-semibold">
            Questions
          </h2>
          {GUIDE_QUESTIONS.map(({ question, answer }) => (
            <div key={question} className="mt-5">
              <h3 className="font-semibold">{question}</h3>
              <p className="mt-1 leading-relaxed">{richText(answer)}</p>
            </div>
          ))}
        </section>
      </article>
    </main>
  );
}
