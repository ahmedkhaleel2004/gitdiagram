import Link from "next/link";
import { JsonLd } from "~/components/json-ld";
import {
  COMPARE_CHECKED,
  ROUNDUP_DESCRIPTION,
  ROUNDUP_DISCLOSURE,
  ROUNDUP_META_TITLE,
  ROUNDUP_NOTES,
  ROUNDUP_PATH,
  ROUNDUP_QUESTIONS,
  ROUNDUP_SOURCES,
  ROUNDUP_TITLE,
  ROUNDUP_TOOLS,
  ROUNDUP_VERDICT,
  comparePath,
} from "~/features/compare/content";
import {
  ArticleSection,
  MoreComparisons,
  Sources,
  cellClass,
  checkedDate,
  headCellClass,
  tableClass,
} from "~/features/compare/compare-ui";
import { compareJsonLd } from "~/features/compare/json-ld";
import { articleMetadata } from "~/features/guide/article-metadata";
import { richText } from "~/features/guide/rich-text";

// An honest roundup of codebase visualization tools, GitDiagram included.
// Standalone: reached from search, the sitemap, the guide and /llms.txt.

export const metadata = articleMetadata({
  path: ROUNDUP_PATH,
  title: ROUNDUP_META_TITLE,
  headline: ROUNDUP_TITLE,
  description: ROUNDUP_DESCRIPTION,
});

function toolId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function ToolLink({ href, children }: { href: string; children: string }) {
  return richText(`[${children}](${href})`);
}

export default function BestCodebaseVisualizationToolsPage() {
  return (
    <main className="container mx-auto max-w-2xl px-6 py-12 text-black dark:text-neutral-100">
      <JsonLd
        data={compareJsonLd({
          path: ROUNDUP_PATH,
          headline: ROUNDUP_TITLE,
          description: ROUNDUP_DESCRIPTION,
          sections: [
            "The tools at a glance",
            ...ROUNDUP_TOOLS.map((tool) => tool.name),
            "Also worth knowing",
          ],
          questions: ROUNDUP_QUESTIONS,
          about: ROUNDUP_TOOLS.map((tool) => tool.name),
          breadcrumbs: [
            { name: "Codebase visualization tools", path: ROUNDUP_PATH },
          ],
        })}
      />
      <article>
        <h1 className="text-3xl font-bold text-balance">{ROUNDUP_TITLE}</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Written by GitDiagram. Checked against each tool&apos;s own docs on{" "}
          <time dateTime={COMPARE_CHECKED}>{checkedDate()}</time>.
        </p>
        <p className="mt-6 leading-relaxed">{richText(ROUNDUP_VERDICT)}</p>
        <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
          {ROUNDUP_DISCLOSURE}
        </p>

        <ArticleSection id="at-a-glance" heading="The tools at a glance">
          <div className="mt-4 overflow-x-auto">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th scope="col" className={`${headCellClass} w-1/4`}>
                    Tool
                  </th>
                  <th scope="col" className={`${headCellClass} w-5/12`}>
                    Best for
                  </th>
                  <th scope="col" className={headCellClass}>
                    Reads the code
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROUNDUP_TOOLS.map((tool) => (
                  <tr key={tool.name}>
                    <th scope="row" className={headCellClass}>
                      <a
                        href={`#${toolId(tool.name)}`}
                        className="hover:underline"
                      >
                        {tool.name}
                      </a>
                    </th>
                    <td className={cellClass}>{richText(tool.bestFor)}</td>
                    <td className={cellClass}>{richText(tool.readsCode)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ArticleSection>

        {ROUNDUP_TOOLS.map((tool) => (
          <ArticleSection
            key={tool.name}
            id={toolId(tool.name)}
            heading={tool.name}
          >
            <p className="mt-3 leading-relaxed">
              <span className="font-semibold">Best for:</span>{" "}
              {richText(tool.bestFor)}.
            </p>
            <p className="mt-3 leading-relaxed">{richText(tool.text)}</p>
            <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              Price: {richText(tool.price)}.{" "}
              {tool.compare ? (
                <Link
                  href={comparePath(tool.compare)}
                  className="neo-link font-medium hover:underline"
                >
                  GitDiagram vs {tool.name}
                </Link>
              ) : tool.href.startsWith("http") ? (
                <ToolLink href={tool.href}>Website</ToolLink>
              ) : null}
            </p>
          </ArticleSection>
        ))}

        <ArticleSection id="also" heading="Also worth knowing">
          {ROUNDUP_NOTES.map((note) => (
            <p key={note} className="mt-3 leading-relaxed">
              {richText(note)}
            </p>
          ))}
        </ArticleSection>

        <ArticleSection id="questions" heading="Questions">
          {ROUNDUP_QUESTIONS.map(({ question, answer }) => (
            <div key={question} className="mt-5">
              <h3 className="font-semibold">{question}</h3>
              <p className="mt-1 leading-relaxed">{richText(answer)}</p>
            </div>
          ))}
        </ArticleSection>

        <Sources
          sources={[
            ...ROUNDUP_SOURCES,
            ...ROUNDUP_TOOLS.filter(
              (tool) => tool.href.startsWith("http") && !tool.compare,
            )
              .filter(
                (tool) =>
                  !ROUNDUP_SOURCES.some((source) => source.url === tool.href),
              )
              .map((tool) => ({ label: tool.name, url: tool.href })),
          ]}
        />
        <MoreComparisons />
      </article>
    </main>
  );
}
