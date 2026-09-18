"use client";

import { ChevronDown, Search } from "lucide-react";

import type { BrowseSort } from "~/features/browse/catalog";

const sortOptions: Array<{ value: BrowseSort; label: string }> = [
  { value: "recent_desc", label: "Newest" },
  { value: "recent_asc", label: "Oldest" },
  { value: "stars_desc", label: "Most Stars" },
  { value: "stars_asc", label: "Least Stars" },
  { value: "name_asc", label: "Name (A-Z)" },
];

const minStarOptions = [
  { value: 0, label: "Any" },
  { value: 10, label: "10+" },
  { value: 100, label: "100+" },
  { value: 1000, label: "1,000+" },
];

export interface BrowseCatalogControlsProps {
  minStars: number;
  onMinStarsChange: (value: number) => void;
  onSearchChange: (value: string) => void;
  onSortChange: (value: BrowseSort) => void;
  searchInput: string;
  sort: BrowseSort;
}

export function BrowseCatalogControls({
  minStars,
  onMinStarsChange,
  onSearchChange,
  onSortChange,
  searchInput,
  sort,
}: BrowseCatalogControlsProps) {
  return (
    <div className="browse-controls neo-panel grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4 rounded-lg p-4 md:grid-cols-[minmax(0,1fr)_220px_180px] md:gap-5 md:p-6">
      <label className="col-span-2 flex min-w-0 flex-col gap-2 md:col-span-1">
        <span className="text-xs font-semibold tracking-[0.1em] text-black uppercase dark:text-[hsl(var(--foreground))]">
          Search Repositories
        </span>
        <span className="relative block">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[hsl(var(--neo-soft-text))]"
          />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search owner/repo"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="neo-input h-12 w-full min-w-0 rounded-md bg-[hsl(var(--background))] pr-3 pl-10 text-base placeholder:text-[hsl(var(--neo-soft-text))]"
          />
        </span>
      </label>

      <label className="flex min-w-0 flex-col gap-2">
        <span className="text-xs font-semibold tracking-[0.1em] text-black uppercase dark:text-[hsl(var(--foreground))]">
          Sort
        </span>
        <span className="relative block">
          <select
            value={sort}
            onChange={(event) => onSortChange(event.target.value as BrowseSort)}
            className="neo-input h-12 w-full min-w-0 appearance-none rounded-md bg-[hsl(var(--background))] pr-7 pl-2.5 text-base"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
          />
        </span>
      </label>

      <label className="flex min-w-0 flex-col gap-2">
        <span className="text-xs font-semibold tracking-[0.1em] text-black uppercase dark:text-[hsl(var(--foreground))]">
          <span className="sm:hidden">Min. stars</span>
          <span className="hidden sm:inline">Minimum Stars</span>
        </span>
        <span className="relative block">
          <select
            aria-label="Minimum Stars"
            value={String(minStars)}
            onChange={(event) =>
              onMinStarsChange(Number.parseInt(event.target.value, 10))
            }
            className="neo-input h-12 w-full min-w-0 appearance-none rounded-md bg-[hsl(var(--background))] pr-7 pl-2.5 text-base"
          >
            {minStarOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
          />
        </span>
      </label>
    </div>
  );
}
