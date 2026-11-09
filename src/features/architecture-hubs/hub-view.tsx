import Link from "next/link";
import { JsonLd } from "~/components/json-ld";
import { richText } from "~/features/guide/rich-text";
import {
  HUBS_TITLE,
  HUB_METHOD,
  formatStars,
  hubFindings,
  hubItemPath,
  hubJsonLd,
  hubLead,
} from "./content";
import {
  HUBS_PATH,
  HUB_PAGE_SIZE,
  hubHeading,
  hubPath,
  type HubIndex,
  type HubPage,
  type HubSummary,
} from "./hubs";

// One hub page: what the most-starred diagrams have in common (page 1 only),
// then the repositories, with plain links to every page.

const linkClass = "neo-link font-medium hover:underline";
const softText = "text-[hsl(var(--neo-soft-text))] dark:text-neutral-400";

function Shares({ hub }: { hub: HubSummary }) {
  const shares = [...(hub.patterns?.shares ?? [])]
    .filter((item) => item.share >= 1)
    .sort((a, b) => b.share - a.share)
    .slice(0, 6);
  if (!hub.patterns || shares.length === 0) return null;
  return (
    <figure
      aria-labelledby="hub-shares-caption"
      className="mt-6 rounded-lg border-2 border-black bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900"
    >
      <figcaption id="hub-shares-caption" className="font-semibold">
        In the {hub.patterns.sample.toLocaleString("en-US")} most-starred
        diagrams
      </figcaption>
      <div className="mt-3 space-y-2">
        {shares.map((item) => (
          <div
            key={item.key}
            className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-2 text-sm sm:grid-cols-[minmax(0,15rem)_1fr_3rem]"
          >
            <span className="truncate">{item.label}</span>
            <span className="h-3 rounded-sm bg-black/[0.06] dark:bg-white/10">
              <span
                className="block h-3 rounded-sm bg-[hsl(var(--neo-link))]"
                style={{ width: `${Math.max(0.5, item.share)}%` }}
              />
            </span>
            <span className="text-right tabular-nums">
              {Math.round(item.share)}%
            </span>
          </div>
        ))}
      </div>
    </figure>
  );
}

function Pagination({ hub, page }: { hub: HubSummary; page: number }) {
  if (hub.pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="mt-6">
      <ul className="flex flex-wrap gap-x-1 gap-y-2 text-sm">
        {page > 1 && (
          <li>
            <Link
              href={hubPath(hub.slug, page - 1)}
              rel="prev"
              className={`${linkClass} inline-block px-2 py-1`}
            >
              ← Previous
            </Link>
          </li>
        )}
        {Array.from({ length: hub.pages }, (_, index) => index + 1).map(
          (number) => (
            <li key={number}>
              {number === page ? (
                <span
                  aria-current="page"
                  className="inline-block rounded border-2 border-black px-2 py-0.5 font-semibold dark:border-neutral-500"
                >
                  {number}
                </span>
              ) : (
                <Link
                  href={hubPath(hub.slug, number)}
                  className={`${linkClass} inline-block px-2 py-1`}
                >
                  {number}
                </Link>
              )}
            </li>
          ),
        )}
        {page < hub.pages && (
          <li>
            <Link
              href={hubPath(hub.slug, page + 1)}
              rel="next"
              className={`${linkClass} inline-block px-2 py-1`}
            >
              Next →
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}

function OtherHubs({ index, current }: { index: HubIndex; current: string }) {
  const others = (kind: HubSummary["kind"]) =>
    index.hubs.filter((hub) => hub.kind === kind && hub.slug !== current);
  return (
    <nav aria-label="More architecture examples" className="mt-12">
      <h2 className="text-xl font-semibold">More architecture examples</h2>
      {(["language", "type"] as const).map((kind) => (
        <p key={kind} className="mt-3 text-sm leading-relaxed">
          <span className="font-semibold">
            {kind === "language" ? "By language: " : "By kind: "}
          </span>
          {others(kind).map((hub, position) => (
            <span key={hub.slug}>
              {position > 0 && " · "}
              <Link href={hubPath(hub.slug)} className={linkClass}>
                {kind === "language"
                  ? hub.name
                  : hubHeading(hub).replace(/ architecture examples$/, "")}
              </Link>
            </span>
          ))}
        </p>
      ))}
      <p className="mt-3 text-sm">
        <Link href={HUBS_PATH} className={linkClass}>
          All architecture examples
        </Link>
      </p>
    </nav>
  );
}

export function HubView({
  index,
  hub,
  page,
}: {
  index: HubIndex;
  hub: HubSummary;
  page: HubPage;
}) {
  const from = (page.page - 1) * HUB_PAGE_SIZE;
  const findings = page.page === 1 ? hubFindings(hub) : [];
  return (
    <main className="container mx-auto max-w-3xl px-4 py-10 text-black sm:px-6 sm:py-12 dark:text-neutral-100">
      <JsonLd data={hubJsonLd(hub, page)} />
      <nav aria-label="Breadcrumb" className={`text-sm ${softText}`}>
        <Link href={HUBS_PATH} className="hover:underline">
          {HUBS_TITLE}
        </Link>
        {page.page > 1 && (
          <>
            {" / "}
            <Link href={hubPath(hub.slug)} className="hover:underline">
              {hub.name}
            </Link>
          </>
        )}
      </nav>
      <h1 className="mt-2 text-3xl font-bold text-balance">
        {hubHeading(hub)}
        {page.page > 1 && `, page ${page.page}`}
      </h1>
      <p className="mt-4 leading-relaxed">{hubLead(hub)}</p>
      {findings.map((text) => (
        <p key={text} className="mt-3 leading-relaxed">
          {text}
        </p>
      ))}
      {page.page === 1 && <Shares hub={hub} />}

      <section aria-labelledby="hub-list-title" className="mt-10">
        <h2 id="hub-list-title" className="text-xl font-semibold">
          Repositories {from + 1}–{from + page.items.length} of{" "}
          {hub.total.toLocaleString("en-US")}
        </h2>
        <ol
          start={from + 1}
          className="neo-panel mt-4 divide-y divide-black/15 overflow-hidden rounded-lg dark:divide-white/10"
        >
          {page.items.map((item, position) => (
            <li key={`${item.owner}/${item.repo}`} className="flex gap-3 p-4">
              <span
                aria-hidden="true"
                className={`w-8 shrink-0 pt-0.5 text-right text-sm tabular-nums ${softText}`}
              >
                {from + position + 1}
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link
                    href={hubItemPath(item)}
                    prefetch={false}
                    className="neo-link font-semibold [overflow-wrap:anywhere] hover:underline"
                  >
                    {item.owner}/{item.repo}
                  </Link>
                  <span className={`text-xs ${softText}`}>
                    ★ {formatStars(item.stars)}
                    {item.language && ` · ${item.language}`}
                  </span>
                </p>
                {item.description && (
                  <p className="mt-1 text-sm leading-relaxed">
                    {item.description}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
        <Pagination hub={hub} page={page.page} />
      </section>

      <p className={`mt-10 text-xs leading-relaxed ${softText}`}>
        {richText(HUB_METHOD)}
      </p>
      <OtherHubs index={index} current={hub.slug} />
    </main>
  );
}
