import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "~/components/json-ld";
import {
  HUBS_DESCRIPTION,
  HUBS_TITLE,
  HUB_METHOD,
  hubsIndexJsonLd,
} from "~/features/architecture-hubs/content";
import {
  HUBS_PATH,
  hubHeading,
  hubPath,
  type HubSummary,
} from "~/features/architecture-hubs/hubs";
import { articleMetadata } from "~/features/guide/article-metadata";
import { richText } from "~/features/guide/rich-text";
import { readArchitectureHubs } from "~/server/storage/architecture-hubs-read";

// Every architecture hub. Read from storage on each request (the build has no
// storage access); the read itself is cached for hours.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...articleMetadata({
    path: HUBS_PATH,
    title: "Open-Source Architecture Examples by Language | GitDiagram",
    headline: HUBS_TITLE,
    description: HUBS_DESCRIPTION,
  }),
  alternates: {
    canonical: HUBS_PATH,
    types: { "text/markdown": `${HUBS_PATH}.md` },
  },
};

const linkClass = "neo-link font-semibold hover:underline";
const softText = "text-[hsl(var(--neo-soft-text))] dark:text-neutral-400";

function HubList({ hubs }: { hubs: HubSummary[] }) {
  return (
    <ul className="neo-panel mt-4 divide-y divide-black/15 overflow-hidden rounded-lg dark:divide-white/10">
      {hubs.map((hub) => (
        <li key={hub.slug} className="p-4">
          <p className="flex flex-wrap items-baseline gap-x-3">
            <Link href={hubPath(hub.slug)} className={linkClass}>
              {hubHeading(hub)}
            </Link>
            <span className={`text-xs ${softText}`}>
              {hub.total.toLocaleString("en-US")} diagrams
            </span>
          </p>
          <p className={`mt-1 text-sm ${softText}`}>
            Most starred:{" "}
            {hub.top.map((name, position) => (
              <span key={name}>
                {position > 0 && ", "}
                <Link
                  href={`/${name.toLowerCase()}`}
                  prefetch={false}
                  className="hover:underline"
                >
                  {name}
                </Link>
              </span>
            ))}
          </p>
        </li>
      ))}
    </ul>
  );
}

export default async function ArchitectureExamplesPage() {
  const index = await readArchitectureHubs();
  if (!index || index.hubs.length === 0) notFound();
  const languages = index.hubs.filter((hub) => hub.kind === "language");
  const kinds = index.hubs.filter((hub) => hub.kind === "type");
  const largest = Math.max(...index.hubs.map((hub) => hub.total));
  return (
    <main className="container mx-auto max-w-3xl px-4 py-10 text-black sm:px-6 sm:py-12 dark:text-neutral-100">
      <JsonLd data={hubsIndexJsonLd(index)} />
      <h1 className="text-3xl font-bold text-balance">{HUBS_TITLE}</h1>
      <p className="mt-4 leading-relaxed">
        Real architecture diagrams of open-source projects on GitHub, grouped by
        language and by kind of project. Each hub lists up to{" "}
        {largest.toLocaleString("en-US")} repositories, most stars first, and
        opens with what the most-starred ones have in common: how many
        components they draw, how often they keep a data store, ship a CLI or a
        web UI, and which files they are built around.
      </p>
      <section aria-labelledby="by-language" className="mt-10">
        <h2 id="by-language" className="text-xl font-semibold">
          By language
        </h2>
        <HubList hubs={languages} />
      </section>
      {kinds.length > 0 && (
        <section aria-labelledby="by-kind" className="mt-10">
          <h2 id="by-kind" className="text-xl font-semibold">
            By kind of project
          </h2>
          <HubList hubs={kinds} />
        </section>
      )}
      <p className={`mt-10 text-xs leading-relaxed ${softText}`}>
        {richText(HUB_METHOD)}
      </p>
    </main>
  );
}
