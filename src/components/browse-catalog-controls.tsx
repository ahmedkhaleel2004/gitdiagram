"use client";

import type { BrowseSort } from "~/features/browse/catalog";
import {
  minStarOptions,
  sortOptions,
} from "~/components/browse-catalog-shared";

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
    <div className="neo-panel grid gap-4 rounded-lg p-5 md:grid-cols-[minmax(0,1fr)_220px_180px] md:gap-5 md:p-6">
      <label className="flex flex-col gap-5">
        <span className="text-sm font-semibold tracking-[0.16em] text-black uppercase dark:text-[hsl(var(--foreground))]">
          Search Repositories
        </span>
        <input
          type="search"
          value={searchInput}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="owner/repo"
          className="neo-input w-full rounded-md bg-[hsl(var(--background))] px-4 py-3 text-base placeholder:text-gray-700 focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none dark:placeholder:text-[hsl(var(--foreground))]"
        />
      </label>

      <label className="flex flex-col gap-5">
        <span className="text-sm font-semibold tracking-[0.16em] text-black uppercase dark:text-[hsl(var(--foreground))]">
          Sort
        </span>
        <select
          value={sort}
          onChange={(event) => onSortChange(event.target.value as BrowseSort)}
          className="neo-input h-[54px] w-full rounded-md bg-[hsl(var(--background))] px-4 text-base focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none"
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-5">
        <span className="text-sm font-semibold tracking-[0.16em] text-black uppercase dark:text-[hsl(var(--foreground))]">
          Minimum Stars
        </span>
        <select
          value={String(minStars)}
          onChange={(event) =>
            onMinStarsChange(Number.parseInt(event.target.value, 10))
          }
          className="neo-input h-[54px] w-full rounded-md bg-[hsl(var(--background))] px-4 text-base focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none"
        >
          {minStarOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
