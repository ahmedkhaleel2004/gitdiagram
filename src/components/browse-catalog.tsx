import Link from "next/link";
import type {
  BrowsePageResult,
  BrowseSort,
} from "~/server/storage/browse-diagrams";

interface BrowseCatalogProps {
  result: BrowsePageResult;
}

const starCountFormatter = new Intl.NumberFormat("en");
const generatedAtFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const sortOptions: Array<{ value: BrowseSort; label: string }> = [
  { value: "recent_desc", label: "Most Recent" },
  { value: "recent_asc", label: "Oldest First" },
  { value: "stars_desc", label: "Most Stars" },
  { value: "stars_asc", label: "Fewest Stars" },
  { value: "name_asc", label: "Name (A-Z)" },
];

const minStarOptions = [
  { value: 0, label: "Any Stars" },
  { value: 10, label: "10+" },
  { value: 100, label: "100+" },
  { value: 1000, label: "1,000+" },
];

function formatStarCount(stargazerCount: number | null) {
  return stargazerCount === null ? "—" : starCountFormatter.format(stargazerCount);
}

function formatGeneratedAt(value: string) {
  return `${generatedAtFormatter.format(new Date(value))} UTC`;
}

function buildBrowseHref(
  current: Pick<BrowsePageResult, "q" | "sort" | "minStars">,
  overrides?: Partial<Pick<BrowsePageResult, "q" | "sort" | "minStars">> & {
    page?: number;
  },
) {
  const params = new URLSearchParams();
  const nextQ = overrides?.q ?? current.q;
  const nextSort = overrides?.sort ?? current.sort;
  const nextMinStars = overrides?.minStars ?? current.minStars;
  const nextPage = overrides?.page ?? 1;

  if (nextQ) {
    params.set("q", nextQ);
  }
  if (nextSort !== "recent_desc") {
    params.set("sort", nextSort);
  }
  if (nextMinStars > 0) {
    params.set("minStars", String(nextMinStars));
  }
  if (nextPage > 1) {
    params.set("page", String(nextPage));
  }

  const queryString = params.toString();
  return queryString ? `/browse?${queryString}` : "/browse";
}

export function BrowseCatalog({ result }: BrowseCatalogProps) {
  const showingStart = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingEnd = Math.min(result.total, result.page * result.pageSize);
  const hasPreviousPage = result.page > 1;
  const hasNextPage = result.page < result.totalPages;

  return (
    <div className="space-y-6">
      <form
        action="/browse"
        method="GET"
        className="neo-panel grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_220px_180px_auto]"
      >
        <label className="space-y-2">
          <span className="text-sm font-semibold uppercase tracking-[0.16em] text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
            Search Repositories
          </span>
          <input
            type="search"
            name="q"
            defaultValue={result.q}
            placeholder="owner/repo"
            className="neo-input w-full rounded-md px-4 py-3 text-base"
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-semibold uppercase tracking-[0.16em] text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
            Sort
          </span>
          <select
            name="sort"
            defaultValue={result.sort}
            className="neo-input h-[54px] w-full rounded-md px-4 text-base"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2">
          <span className="text-sm font-semibold uppercase tracking-[0.16em] text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
            Minimum Stars
          </span>
          <select
            name="minStars"
            defaultValue={String(result.minStars)}
            className="neo-input h-[54px] w-full rounded-md px-4 text-base"
          >
            {minStarOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end gap-3">
          <button type="submit" className="neo-button h-[54px] px-5 font-semibold">
            Apply
          </button>
          <Link
            href="/browse"
            className="neo-button-muted inline-flex h-[54px] items-center px-5 font-semibold"
          >
            Reset
          </Link>
        </div>
      </form>

      {result.total === 0 ? (
        <div className="neo-panel p-10 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
            Browse
          </p>
          <h2 className="mt-3 text-3xl font-bold">No diagrams match these filters</h2>
          <p className="mt-4 text-base text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
            Try a broader search or lower the minimum star filter.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
              Showing {showingStart}-{showingEnd} of {starCountFormatter.format(result.total)} public diagrams
            </p>
            <p className="text-sm text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
              Sorted from cached browse metadata so this catalog can stay fast.
            </p>
          </div>

          <div className="neo-panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="border-b-[3px] border-black bg-[hsl(var(--neo-panel-muted))] text-left text-sm uppercase tracking-[0.16em] dark:border-[#0d0a19] dark:bg-[hsl(var(--neo-panel-muted))]">
                    <th className="px-5 py-4 font-semibold">Repository</th>
                    <th className="px-5 py-4 font-semibold">Stars</th>
                    <th className="px-5 py-4 font-semibold">Last Generated</th>
                    <th className="px-5 py-4 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => {
                    const diagramPath = `/${encodeURIComponent(item.username)}/${encodeURIComponent(item.repo)}`;
                    const githubPath = `https://github.com/${item.username}/${item.repo}`;

                    return (
                      <tr
                        key={`${item.username}/${item.repo}`}
                        className="border-b border-black/15 last:border-b-0 dark:border-white/10"
                      >
                        <td className="px-5 py-4">
                          <Link
                            href={diagramPath}
                            className="block text-lg font-semibold tracking-tight hover:underline"
                          >
                            {item.username}/{item.repo}
                          </Link>
                        </td>
                        <td className="px-5 py-4 text-sm font-semibold">
                          {formatStarCount(item.stargazerCount)}
                        </td>
                        <td className="px-5 py-4 text-sm text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
                          <time dateTime={item.lastSuccessfulAt}>
                            {formatGeneratedAt(item.lastSuccessfulAt)}
                          </time>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap gap-3">
                            <Link
                              href={diagramPath}
                              className="neo-button inline-flex items-center px-4 py-2 text-sm font-semibold"
                            >
                              Open Diagram
                            </Link>
                            <Link
                              href={githubPath}
                              className="neo-button-muted inline-flex items-center px-4 py-2 text-sm font-semibold"
                            >
                              GitHub
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
              Page {result.page} of {result.totalPages}
            </p>
            <div className="flex gap-3">
              <Link
                href={
                  hasPreviousPage
                    ? buildBrowseHref(result, { page: result.page - 1 })
                    : "#"
                }
                aria-disabled={!hasPreviousPage}
                className={`inline-flex items-center px-4 py-2 text-sm font-semibold ${
                  hasPreviousPage
                    ? "neo-button-muted"
                    : "cursor-not-allowed rounded-md border-[3px] border-black bg-[hsl(var(--neo-subtle-muted))] px-4 py-2 opacity-50 dark:border-[#1a0d30]"
                }`}
              >
                Previous
              </Link>
              <Link
                href={
                  hasNextPage
                    ? buildBrowseHref(result, { page: result.page + 1 })
                    : "#"
                }
                aria-disabled={!hasNextPage}
                className={`inline-flex items-center px-4 py-2 text-sm font-semibold ${
                  hasNextPage
                    ? "neo-button"
                    : "cursor-not-allowed rounded-md border-[3px] border-black bg-[hsl(var(--neo-button))] px-4 py-2 opacity-50 dark:border-[#1a0d30]"
                }`}
              >
                Next
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
