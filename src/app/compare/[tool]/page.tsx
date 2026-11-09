import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "~/components/json-ld";
import {
  COMPARE_CHECKED,
  COMPARE_PAGES,
  ROUNDUP_PATH,
  comparePage,
  comparePath,
} from "~/features/compare/content";
import {
  ArticleSection,
  CodeBlock,
  MoreComparisons,
  MoreGuides,
  Sources,
  cellClass,
  checkedDate,
  headCellClass,
  tableClass,
} from "~/features/compare/compare-ui";
import { compareJsonLd } from "~/features/compare/json-ld";
import { articleMetadata } from "~/features/guide/article-metadata";
import { richText } from "~/features/guide/rich-text";

// GitDiagram next to one other tool. Standalone pages, reached from search,
// the sitemap, /visualize-codebase and /llms.txt; nothing in the site's
// header, footer or repository pages links here.

export const dynamicParams = false;

export function generateStaticParams() {
  return COMPARE_PAGES.map((page) => ({ tool: page.slug }));
}

type Props = { params: Promise<{ tool: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = comparePage((await params).tool);
  if (!page) return {};
  return articleMetadata({
    path: comparePath(page.slug),
    title: page.metaTitle,
    headline: page.title,
    description: page.description,
  });
}

export default async function ComparePageView({ params }: Props) {
  const page = comparePage((await params).tool);
  if (!page) notFound();
  const path = comparePath(page.slug);
  return (
    <main className="container mx-auto max-w-2xl px-6 py-12 text-black dark:text-neutral-100">
      <JsonLd
        data={compareJsonLd({
          path,
          headline: page.title,
          description: page.description,
          sections: [
            "Which to choose",
            ...page.sections.map((section) => section.heading),
            "At a glance",
          ],
          questions: page.questions,
          about: ["GitDiagram", page.tool],
          breadcrumbs: [
            { name: "Codebase visualization tools", path: ROUNDUP_PATH },
            { name: `GitDiagram vs ${page.tool}`, path },
          ],
        })}
      />
      <article>
        <h1 className="text-3xl font-bold text-balance">{page.title}</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Written by GitDiagram. Facts about {page.tool} checked against its own
          docs on <time dateTime={COMPARE_CHECKED}>{checkedDate()}</time> (
          <a href="#sources" className="hover:underline">
            sources
          </a>
          ).
        </p>
        <p className="mt-6 leading-relaxed">{richText(page.verdict)}</p>

        <ArticleSection id="which-to-choose" heading="Which to choose">
          <div className="mt-4 overflow-x-auto">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th scope="col" className={`${headCellClass} w-1/2`}>
                    Choose {page.tool} when
                  </th>
                  <th scope="col" className={`${headCellClass} w-1/2`}>
                    Choose GitDiagram when
                  </th>
                </tr>
              </thead>
              <tbody>
                {Array.from(
                  {
                    length: Math.max(
                      page.chooseOther.length,
                      page.chooseGitDiagram.length,
                    ),
                  },
                  (_, row) => (
                    <tr key={row}>
                      <td className={cellClass}>
                        {richText(page.chooseOther[row] ?? "")}
                      </td>
                      <td className={cellClass}>
                        {richText(page.chooseGitDiagram[row] ?? "")}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
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

        <ArticleSection id="at-a-glance" heading="At a glance">
          <div className="mt-4 overflow-x-auto">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th scope="col" className={`${headCellClass} w-1/5`}>
                    <span className="sr-only">Question</span>
                  </th>
                  <th scope="col" className={`${headCellClass} w-2/5`}>
                    GitDiagram
                  </th>
                  <th scope="col" className={`${headCellClass} w-2/5`}>
                    {page.tool}
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.facts.map((fact) => (
                  <tr key={fact.label}>
                    <th scope="row" className={headCellClass}>
                      {fact.label}
                    </th>
                    <td className={cellClass}>{richText(fact.gitdiagram)}</td>
                    <td className={cellClass}>{richText(fact.other)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ArticleSection>

        <ArticleSection id="questions" heading="Questions">
          {page.questions.map(({ question, answer }) => (
            <div key={question} className="mt-5">
              <h3 className="font-semibold">{question}</h3>
              <p className="mt-1 leading-relaxed">{richText(answer)}</p>
            </div>
          ))}
        </ArticleSection>

        <Sources sources={page.sources} />
        <MoreComparisons current={page.slug} />
        <MoreGuides />
      </article>
    </main>
  );
}
