import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "~/components/json-ld";
import {
  ArticleSection,
  CodeBlock,
  Sources,
  checkedDate,
} from "~/features/compare/compare-ui";
import { ROUNDUP_PATH } from "~/features/compare/content";
import { compareJsonLd } from "~/features/compare/json-ld";
import { articleMetadata } from "~/features/guide/article-metadata";
import { guidePlainText } from "~/features/guide/content";
import { richText } from "~/features/guide/rich-text";
import {
  GUIDES_HUB_PATH,
  SITUATIONS_CHECKED,
  SITUATION_PAGES,
  diagramPicturePath,
  situationPage,
  situationPath,
  type SituationPage,
} from "~/features/situations/content";
import { SITE_URL } from "~/lib/site";

// Guides built around a situation ("I just joined a team with a huge
// monorepo"). Standalone pages, reached from search, the sitemap,
// /visualize-codebase, the comparison pages and /llms.txt; nothing in the
// site's header, footer or repository pages links here.

export const dynamicParams = false;

export function generateStaticParams() {
  return SITUATION_PAGES.map((page) => ({ slug: page.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = situationPage((await params).slug);
  if (!page) return {};
  return articleMetadata({
    path: situationPath(page.slug),
    title: page.metaTitle,
    headline: page.title,
    description: page.description,
  });
}

function howTo(page: SituationPage) {
  const url = `${SITE_URL}${situationPath(page.slug)}`;
  return {
    "@type": "HowTo",
    "@id": `${url}#steps`,
    name: page.title,
    description: guidePlainText(page.answer),
    step: page.steps.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: step.name,
      text: guidePlainText(step.text),
      url: `${url}#step-${index + 1}`,
    })),
  };
}

export default async function SituationPageView({ params }: Props) {
  const page = situationPage((await params).slug);
  if (!page) notFound();
  const path = situationPath(page.slug);
  const { example } = page;
  return (
    <main className="container mx-auto max-w-2xl px-6 py-12 text-black dark:text-neutral-100">
      <JsonLd
        data={compareJsonLd({
          path,
          headline: page.title,
          description: page.description,
          sections: [
            page.stepsHeading,
            example.heading,
            ...page.sections.map((section) => section.heading),
          ],
          questions: page.questions,
          about: ["GitDiagram"],
          breadcrumbs: [
            { name: "How to visualize a codebase", path: GUIDES_HUB_PATH },
            { name: page.label, path },
          ],
          date: SITUATIONS_CHECKED,
          extra: [howTo(page)],
        })}
      />
      <article>
        <h1 className="text-3xl font-bold text-balance">{page.title}</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Written by GitDiagram. Checked on{" "}
          <time dateTime={SITUATIONS_CHECKED}>
            {checkedDate(SITUATIONS_CHECKED)}
          </time>{" "}
          (
          <a href="#sources" className="hover:underline">
            sources
          </a>
          ).
        </p>
        <p className="mt-6 leading-relaxed">{richText(page.answer)}</p>

        <ArticleSection id="steps" heading={page.stepsHeading}>
          <ol className="mt-4 list-decimal space-y-3 pl-5">
            {page.steps.map((step, index) => (
              <li
                key={step.name}
                id={`step-${index + 1}`}
                className="scroll-mt-8 leading-relaxed"
              >
                <strong className="font-semibold">{step.name}.</strong>{" "}
                {richText(step.text)}
              </li>
            ))}
          </ol>
        </ArticleSection>

        <ArticleSection id="example" heading={example.heading}>
          <figure className="mt-4">
            <Link href={`/${example.repo}`} className="block">
              {/* eslint-disable-next-line @next/next/no-img-element -- a stored diagram's picture, already sized */}
              <img
                src={diagramPicturePath(example.repo)}
                alt={`Architecture diagram of ${example.repo}: its main parts, grouped`}
                width={1200}
                height={630}
                loading="lazy"
                decoding="async"
                className="h-auto w-full rounded border border-neutral-200 dark:border-neutral-800"
              />
            </Link>
            <figcaption className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              {richText(
                `The stored diagram of [${example.repo}](/${example.repo}). Open it for the interactive version, with every part linked to its code.`,
              )}
            </figcaption>
          </figure>
          {example.paragraphs.map((paragraph) => (
            <p key={paragraph} className="mt-3 leading-relaxed">
              {richText(paragraph)}
            </p>
          ))}
          {example.code && <CodeBlock {...example.code} />}
        </ArticleSection>

        {page.sections.map((section) => (
          <ArticleSection
            key={section.id}
            id={section.id}
            heading={section.heading}
          >
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="mt-3 leading-relaxed">
                {richText(paragraph)}
              </p>
            ))}
            {section.code && <CodeBlock {...section.code} />}
          </ArticleSection>
        ))}

        {page.questions.length > 0 && (
          <ArticleSection id="questions" heading="Questions">
            {page.questions.map(({ question, answer }) => (
              <div key={question} className="mt-5">
                <h3 className="font-semibold">{question}</h3>
                <p className="mt-1 leading-relaxed">{richText(answer)}</p>
              </div>
            ))}
          </ArticleSection>
        )}

        <Sources sources={page.sources} checked={SITUATIONS_CHECKED} />

        <nav aria-label="More guides" className="mt-10">
          <h2 className="text-xl font-semibold">More guides</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            {SITUATION_PAGES.filter((other) => other.slug !== page.slug).map(
              (other) => (
                <li key={other.slug}>
                  <Link
                    href={situationPath(other.slug)}
                    className="neo-link font-medium hover:underline"
                  >
                    {other.label}
                  </Link>
                </li>
              ),
            )}
            <li>
              <Link
                href={GUIDES_HUB_PATH}
                className="neo-link font-medium hover:underline"
              >
                How to visualize a codebase
              </Link>
            </li>
            <li>
              <Link
                href={ROUNDUP_PATH}
                className="neo-link font-medium hover:underline"
              >
                Codebase visualization tools compared
              </Link>
            </li>
          </ul>
        </nav>
      </article>
    </main>
  );
}
