import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { JsonLd } from "~/components/json-ld";
import {
  REPORT,
  REPORT_DATASET,
  REPORT_DESCRIPTION,
  REPORT_FINDINGS,
  REPORT_LIMITS,
  REPORT_PATH,
  REPORT_PUBLISHED,
  REPORT_SCRIPTS,
  REPORT_TITLE,
  REPORT_URL,
} from "~/features/architecture-report/content";
import { HUBS_PATH } from "~/features/architecture-hubs/hubs";
import { SITE_URL } from "~/lib/site";

const OG_IMAGE = `${REPORT_PATH}/opengraph-image`;

export const metadata: Metadata = {
  title: "How Top Open-Source Repos Are Built: 2026 Report",
  description: REPORT_DESCRIPTION,
  alternates: {
    canonical: REPORT_PATH,
    types: { "text/markdown": `${REPORT_PATH}.md` },
  },
  openGraph: {
    title: REPORT_TITLE,
    description: REPORT_DESCRIPTION,
    url: REPORT_URL,
    siteName: "GitDiagram",
    type: "article",
    publishedTime: REPORT_PUBLISHED,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: REPORT_TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: REPORT_TITLE,
    description: REPORT_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

const linkClass = "neo-link font-medium hover:underline";
const codeClass =
  "rounded bg-black/[0.06] px-1 py-px font-mono text-[0.85em] break-words dark:bg-white/10";
const SERIES = [
  "bg-[hsl(var(--neo-link))]",
  "bg-sky-400",
  "bg-neutral-800 dark:bg-neutral-300",
] as const;

const LANGUAGE_COLUMNS = [
  { key: "cli", heading: "CLI" },
  { key: "web", heading: "Web UI" },
  { key: "desktop", heading: "Desktop" },
  { key: "plugins", heading: "Plugins" },
  { key: "storage", heading: "Data store" },
  { key: "workspace", heading: "Workspace" },
  { key: "llm", heading: "LLM" },
] as const;

const SHORT_LABELS: Record<string, string> = {
  llm: "LLM or AI model",
  mcp: "MCP",
  cli: "Command line",
  web: "Web interface",
  desktop: "Desktop app",
  plugins: "Plugins or extensions",
};

/** A path on gitdiagram.com for a report URL, so it navigates in the app. */
function sitePath(url: string) {
  return url.replace(SITE_URL, "");
}

function RepoLink({ repository, url }: { repository: string; url: string }) {
  return (
    <Link href={sitePath(url)} className={linkClass}>
      {repository}
    </Link>
  );
}

function Examples({
  list,
}: {
  list: ReadonlyArray<{ repository: string; url: string }>;
}) {
  return (
    <>
      {list.map((item, index) => (
        <span key={item.url}>
          {index > 0 && (index === list.length - 1 ? " and " : ", ")}
          <RepoLink {...item} />
        </span>
      ))}
    </>
  );
}

function Bar({
  label,
  value,
  max = 100,
  suffix = "%",
  color = SERIES[0],
}: {
  label: ReactNode;
  value: number;
  max?: number;
  suffix?: string;
  color?: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr_3.5rem] items-center gap-2 text-sm sm:grid-cols-[minmax(0,13rem)_1fr_3.5rem]">
      <span className="truncate">{label}</span>
      <span className="h-3 rounded-sm bg-black/[0.06] dark:bg-white/10">
        <span
          className={`block h-3 rounded-sm ${color}`}
          style={{ width: `${Math.max(0.5, (value / max) * 100)}%` }}
        />
      </span>
      <span className="text-right tabular-nums">
        {value.toLocaleString("en-US")}
        {suffix}
      </span>
    </div>
  );
}

function Chart({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure
      aria-labelledby={`${id}-caption`}
      className="mt-5 rounded-lg border-2 border-black bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900"
    >
      <figcaption id={`${id}-caption`} className="font-semibold">
        {title}
      </figcaption>
      <div className="mt-3 space-y-2">{children}</div>
      <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
        {note}
      </p>
    </figure>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="mt-12 scroll-mt-8"
    >
      <h2 id={`${id}-title`} className="text-xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function reportJsonLd() {
  const publisher = {
    "@type": "Organization",
    name: "GitDiagram",
    url: SITE_URL,
  };
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${REPORT_URL}#article`,
        headline: REPORT_TITLE,
        description: REPORT_DESCRIPTION,
        url: REPORT_URL,
        mainEntityOfPage: REPORT_URL,
        image: `${SITE_URL}${OG_IMAGE}`,
        inLanguage: "en",
        datePublished: REPORT_PUBLISHED,
        dateModified: REPORT_PUBLISHED,
        author: publisher,
        publisher,
        isBasedOn: { "@id": `${REPORT_URL}#dataset` },
      },
      {
        "@type": "Dataset",
        "@id": `${REPORT_URL}#dataset`,
        name: "Architecture of the most-starred open-source repositories (2026)",
        description: `One row per repository: stars, primary language, creation year, component and connection counts, and the architectural traits found in its GitDiagram diagram, for the ${REPORT.sample.size} most-starred public GitHub repositories with a stored diagram.`,
        url: REPORT_URL,
        license: "https://creativecommons.org/licenses/by/4.0/",
        creator: publisher,
        datePublished: REPORT_PUBLISHED,
        temporalCoverage: `${REPORT.sample.diagramDates.first}/${REPORT.sample.diagramDates.last}`,
        isAccessibleForFree: true,
        distribution: [
          {
            "@type": "DataDownload",
            encodingFormat: "text/csv",
            contentUrl: `${SITE_URL}${REPORT_DATASET.csv}`,
          },
          {
            "@type": "DataDownload",
            encodingFormat: "application/json",
            contentUrl: `${SITE_URL}${REPORT_DATASET.json}`,
          },
        ],
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
            name: "Open-source architecture report 2026",
            item: REPORT_URL,
          },
        ],
      },
    ],
  };
}

export default function ArchitectureReportPage() {
  const r = REPORT;
  const traits = [...r.traits].sort((a, b) => b.share - a.share);
  return (
    <main className="container mx-auto max-w-3xl px-4 py-12 text-black sm:px-6 dark:text-neutral-100">
      <JsonLd data={reportJsonLd()} />
      <article>
        <p className="text-sm font-semibold tracking-wide text-[hsl(var(--neo-link))] uppercase">
          GitDiagram data report
        </p>
        <h1 className="mt-2 text-3xl font-bold text-balance">{REPORT_TITLE}</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Published <time dateTime={REPORT_PUBLISHED}>November 9, 2026</time> ·
          from {r.sample.size.toLocaleString("en-US")} stored architecture
          diagrams ·{" "}
          <a href={REPORT_DATASET.csv} download className={linkClass}>
            CSV
          </a>{" "}
          ·{" "}
          <a href={REPORT_DATASET.json} download className={linkClass}>
            JSON
          </a>
        </p>
        <p className="mt-6 leading-relaxed">
          GitDiagram turns a GitHub repository into an architecture diagram: its
          main components, how they connect, and which file each one lives in.
          It keeps every public diagram it makes,{" "}
          {r.storedPublicDiagrams.toLocaleString("en-US")} of them on{" "}
          {r.indexReadAt}. We read the diagrams of the{" "}
          {r.sample.size.toLocaleString("en-US")} most-starred repositories
          among them, from {r.sample.maxStars.toLocaleString("en-US")} stars
          down to {r.sample.minStars.toLocaleString("en-US")}, and counted what
          they are made of. Every repository named below links to its diagram,
          and a separate page lists the diagrams of{" "}
          <Link href="/most-starred-repositories" className={linkClass}>
            the most-starred GitHub repositories
          </Link>
          .
        </p>

        <Section id="findings" title="Key findings">
          <ul className="mt-4 space-y-4">
            {REPORT_FINDINGS.map((finding) => (
              <li key={finding.title} className="leading-relaxed">
                <strong>{finding.title}.</strong> {finding.text}
              </li>
            ))}
          </ul>
        </Section>

        <Section id="ai" title="AI shows up in the architecture">
          <p className="mt-3 leading-relaxed">
            Grouped by the year GitHub says each repository was created, the
            newer the project, the more often its diagram has a component for an
            LLM or model provider, speaks the Model Context Protocol, or draws
            an AI agent among the actors that use it. Projects from 2023 and
            2024 lead on LLM components; projects from 2025 on are the first
            where agents are a common kind of user. Examples:{" "}
            <Examples list={r.actors.agentExamples} />.
          </p>
          <Chart
            id="era-chart"
            title="Share of diagrams, by the year the repository was created"
            note={
              <>
                <span className="mr-3 inline-flex items-center gap-1">
                  <span className={`size-2.5 rounded-sm ${SERIES[0]}`} /> LLM or
                  model component
                </span>
                <span className="mr-3 inline-flex items-center gap-1">
                  <span className={`size-2.5 rounded-sm ${SERIES[1]}`} /> MCP
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className={`size-2.5 rounded-sm ${SERIES[2]}`} /> AI
                  agent drawn as a user
                </span>
              </>
            }
          >
            {r.byEra.map((era) => (
              <div key={era.era} className="space-y-1 pb-2">
                <p className="text-sm font-medium">
                  {era.era}{" "}
                  <span className="font-normal text-neutral-600 dark:text-neutral-400">
                    ({era.repositories} repositories)
                  </span>
                </p>
                <Bar label="LLM or model" value={era.llm} max={50} />
                <Bar label="MCP" value={era.mcp} max={50} color={SERIES[1]} />
                <Bar
                  label="Agent as a user"
                  value={era.agentActor}
                  max={50}
                  color={SERIES[2]}
                />
              </div>
            ))}
          </Chart>
        </Section>

        <Section id="shape" title="What the top repositories are made of">
          <p className="mt-3 leading-relaxed">
            Across all {r.sample.size.toLocaleString("en-US")}:{" "}
            {r.storage.share}% draw a data store and {r.queue.share}% a queue or
            event bus; {r.actors.share}% draw at least one outside actor, most
            often a “user” or a “developer”. Repositories with a job or event
            queue include <Examples list={r.queue.examples} />.
          </p>
          <Chart
            id="trait-chart"
            title="Share of all diagrams with each part"
            note="A part counts when a component or group name matches the rule listed under Method; data stores and queues are counted by the shape the diagram draws them with."
          >
            <Bar label="Data store" value={r.storage.share} />
            {traits.map((t) => (
              <Bar
                key={t.key}
                label={SHORT_LABELS[t.key] ?? t.label}
                value={t.share}
              />
            ))}
            <Bar label="Queue or event bus" value={r.queue.share} />
          </Chart>
        </Section>

        <Section id="languages" title="By language">
          <p className="mt-3 leading-relaxed">
            Each language with at least 40 repositories in the sample. Highest
            share in each column:{" "}
            {LANGUAGE_COLUMNS.map((column, index) => {
              const top = [...r.byLanguage].sort(
                (a, b) => b[column.key] - a[column.key],
              )[0]!;
              return (
                <span key={column.key}>
                  {index > 0 && "; "}
                  {column.heading} {top.language} ({top[column.key]}%)
                </span>
              );
            })}
            .
          </p>
          <div className="mt-5 overflow-x-auto rounded-lg border-2 border-black dark:border-neutral-700">
            <table className="w-full min-w-[36rem] bg-white text-sm tabular-nums dark:bg-neutral-900">
              <caption className="sr-only">
                Share of diagrams with each part, by primary language
              </caption>
              <thead>
                <tr className="border-b-2 border-black text-left dark:border-neutral-700">
                  {[
                    "Language",
                    "Repos",
                    ...LANGUAGE_COLUMNS.map((column) => column.heading),
                  ].map((heading) => (
                    <th key={heading} scope="col" className="px-2 py-2">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.byLanguage.map((l) => (
                  <tr
                    key={l.language}
                    className="border-b border-black/10 last:border-0 dark:border-white/10"
                  >
                    <th scope="row" className="px-2 py-2 text-left font-medium">
                      {l.language}
                    </th>
                    <td className="px-2 py-2">{l.repositories}</td>
                    {LANGUAGE_COLUMNS.map(({ key }) => (
                      <td key={key} className="px-2 py-2">
                        {l[key]}%
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 leading-relaxed">
            Hundreds more diagrams per language, with the same counts:{" "}
            <Link href={HUBS_PATH} className={linkClass}>
              architecture examples by language and kind of project
            </Link>
            .
          </p>
        </Section>

        <Section id="layout" title="How repositories are laid out">
          <p className="mt-3 leading-relaxed">
            {r.workspace.share}% of diagrams link components to files in
            workspace folders, the sign of a monorepo split into packages.
            packages/ is by far the most common, then apps/ and crates/.
            Examples: <Examples list={r.workspace.examples} />. In Go,{" "}
            {r.conventions.goCmdInternal}% of diagrams link into cmd/ or
            internal/; in Rust, {r.conventions.rustCrates}% link into crates/.
          </p>
          <Chart
            id="workspace-chart"
            title="Repositories linking files in each workspace folder"
            note={`Out of ${r.sample.size.toLocaleString("en-US")}. A repository can use more than one.`}
          >
            {r.workspace.folders.map((folder) => (
              <Bar
                key={folder.name}
                label={<code className={codeClass}>{folder.name}</code>}
                value={folder.repositories}
                max={r.workspace.folders[0]!.repositories}
                suffix=""
              />
            ))}
          </Chart>
          <h3 className="mt-8 font-semibold">
            The files diagrams point to most, by language
          </h3>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            The number of repositories whose diagram links a component to a file
            with that name (READMEs left out).
          </p>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {r.entryFilesByLanguage.map((entry) => (
              <div key={entry.language}>
                <dt className="font-medium">{entry.language}</dt>
                <dd className="mt-1 text-sm leading-relaxed">
                  {entry.files.map((file, index) => (
                    <span key={file.name}>
                      {index > 0 && ", "}
                      <code className={codeClass}>{file.name}</code>{" "}
                      {file.repositories}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section id="top-ten" title="The ten most-starred repositories">
          <ol className="mt-4 space-y-3">
            {r.topTen.map((repo) => (
              <li key={repo.url} className="leading-relaxed">
                <RepoLink repository={repo.repository} url={repo.url} />{" "}
                <span className="text-sm text-neutral-600 dark:text-neutral-400">
                  {repo.stars.toLocaleString("en-US")} stars ·{" "}
                  {repo.language ?? "no primary language"} · {repo.components}{" "}
                  components
                </span>
                <br />
                <span className="text-sm">{repo.groups.join(" · ")}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 leading-relaxed">
            Six of the ten are lists, books or courses, which GitDiagram
            diagrams as the structure of their content. They stay in the sample
            because they are what the most-starred repositories are.
          </p>
        </Section>

        <Section id="method" title="Method">
          <p className="mt-3 leading-relaxed">
            We read GitDiagram’s index of stored public diagrams on{" "}
            {r.indexReadAt} and took the{" "}
            {r.candidatesRead.toLocaleString("en-US")} entries with the most
            stars. Of those, {r.excluded.withoutGraph} had a diagram from before
            GitDiagram stored a component graph (made between December 2024 and
            March 2026), {r.excluded.duplicates} were renamed repositories
            stored under two names, {r.excluded.forks} was a fork and{" "}
            {r.excluded.unavailable} no longer exists on GitHub. Stars, primary
            language and creation year come from the GitHub API on{" "}
            {r.indexReadAt}; the sample is the{" "}
            {r.sample.size.toLocaleString("en-US")} most-starred of the rest.
            Only public repositories and public diagrams were read. The median
            diagram has {r.size.components.median} components,{" "}
            {r.size.connections.median} connections and {r.size.groups.median}{" "}
            groups; {r.size.linkedShare}% of components link to a real file or
            folder.
          </p>
          <p className="mt-3 leading-relaxed">
            A trait counts when this regular expression matches a component or
            group name, lowercased:
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {r.traits.map((t) => (
              <li key={t.key}>
                {t.label}: <code className={codeClass}>/{t.rule}/</code>
              </li>
            ))}
            <li>
              AI agent as a user: an outside actor matching{" "}
              <code className={codeClass}>/{r.actors.rule}/</code>
            </li>
          </ul>
          <p className="mt-3 leading-relaxed">
            The scripts that fetched and counted the data are{" "}
            <a
              href={REPORT_SCRIPTS}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              in GitDiagram’s repository
            </a>
            . Anyone can check a single row by opening that repository’s
            diagram.
          </p>
        </Section>

        <Section id="limits" title="Limits">
          <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
            {REPORT_LIMITS.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </Section>

        <Section id="data" title="Download and cite">
          <p className="mt-3 leading-relaxed">
            One row per repository, with its rank, stars, language, creation
            year, counts and traits:{" "}
            <a href={REPORT_DATASET.csv} download className={linkClass}>
              CSV
            </a>{" "}
            or{" "}
            <a href={REPORT_DATASET.json} download className={linkClass}>
              JSON
            </a>{" "}
            (with the rules). Also as{" "}
            <a href={`${REPORT_PATH}.md`} className={linkClass}>
              Markdown
            </a>
            . Free to reuse under CC BY 4.0. Cite as: GitDiagram, “
            {REPORT_TITLE}”, {REPORT_PUBLISHED}, {REPORT_URL}.
          </p>
          <p className="mt-3 leading-relaxed">
            To see any repository’s own diagram, replace “hub” with “diagram” in
            its GitHub URL, or{" "}
            <Link href="/visualize-codebase" className={linkClass}>
              read how to visualize a codebase
            </Link>
            .
          </p>
        </Section>
      </article>
    </main>
  );
}
