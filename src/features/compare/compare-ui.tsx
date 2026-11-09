import Link from "next/link";
import type { ReactNode } from "react";
import { richText } from "~/features/guide/rich-text";
import { SITUATION_PAGES, situationPath } from "~/features/situations/content";
import {
  COMPARE_CHECKED,
  COMPARE_PAGES,
  ROUNDUP_PATH,
  comparePath,
  type CompareSource,
} from "./content";

// Pieces the comparison pages share, in the guide's typography.

export const tableClass = "w-full border-collapse text-left text-sm";
export const cellClass =
  "border-b border-neutral-200 py-2 pr-3 align-top leading-relaxed dark:border-neutral-800";
export const headCellClass = `${cellClass} font-semibold`;

export function checkedDate(date: string = COMPARE_CHECKED): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function ArticleSection({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="mt-10 scroll-mt-8"
    >
      <h2 id={`${id}-title`} className="text-xl font-semibold">
        {heading}
      </h2>
      {children}
    </section>
  );
}

export function CodeBlock({
  caption,
  text,
}: {
  caption: string;
  text: string;
}) {
  return (
    <figure className="mt-4">
      <figcaption className="font-mono text-xs text-neutral-600 dark:text-neutral-400">
        {caption}
      </figcaption>
      <pre className="mt-1 overflow-x-auto rounded bg-black/[0.06] p-3 font-mono text-xs leading-relaxed dark:bg-white/10">
        <code>{text}</code>
      </pre>
    </figure>
  );
}

export function Sources({
  sources,
  checked = COMPARE_CHECKED,
}: {
  sources: CompareSource[];
  /** When the facts were checked. */
  checked?: string;
}) {
  return (
    <ArticleSection id="sources" heading="Sources">
      <p className="mt-3 leading-relaxed">
        Checked on <time dateTime={checked}>{checkedDate(checked)}</time>.
        Products change: if something here is out of date,{" "}
        {richText(
          "[open an issue](https://github.com/ahmedkhaleel2004/gitdiagram/issues).",
        )}
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5">
        {sources.map((source) => (
          <li key={source.url}>
            {richText(`[${source.label}](${source.url})`)}
          </li>
        ))}
      </ul>
    </ArticleSection>
  );
}

/** Links to the other comparisons, the roundup and the guide. */
export function MoreComparisons({ current }: { current?: string }) {
  return (
    <nav aria-label="More comparisons" className="mt-10">
      <h2 className="text-xl font-semibold">More comparisons</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5">
        {COMPARE_PAGES.filter((page) => page.slug !== current).map((page) => (
          <li key={page.slug}>
            <Link
              href={comparePath(page.slug)}
              className="neo-link font-medium hover:underline"
            >
              GitDiagram vs {page.tool}
            </Link>
          </li>
        ))}
        {current && (
          <li>
            <Link
              href={ROUNDUP_PATH}
              className="neo-link font-medium hover:underline"
            >
              All codebase visualization tools compared
            </Link>
          </li>
        )}
        <li>
          <Link
            href="/visualize-codebase"
            className="neo-link font-medium hover:underline"
          >
            How to visualize a codebase
          </Link>
        </li>
      </ul>
    </nav>
  );
}

/** Links to the situation guides (/guides/{slug}). */
export function MoreGuides() {
  return (
    <nav aria-label="Guides by situation" className="mt-10">
      <h2 className="text-xl font-semibold">Guides by situation</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5">
        {SITUATION_PAGES.map((page) => (
          <li key={page.slug}>
            <Link
              href={situationPath(page.slug)}
              className="neo-link font-medium hover:underline"
            >
              {page.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
