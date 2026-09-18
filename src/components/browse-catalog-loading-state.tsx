"use client";

import { Skeleton } from "~/components/ui/skeleton";
import {
  BrowseCatalogControls,
  type BrowseCatalogControlsProps,
} from "~/components/browse-catalog-controls";

const browseSkeletonRows = Array.from({ length: 6 }, (_, index) => index);

export function BrowseCatalogLoadingState(props: BrowseCatalogControlsProps) {
  return (
    <div className="space-y-4 sm:space-y-6" aria-busy="true" aria-live="polite">
      <BrowseCatalogControls {...props} />

      <Skeleton className="h-5 w-64 max-w-full" />

      <div className="neo-panel overflow-hidden rounded-lg">
        <table className="block w-full border-collapse lg:table lg:table-fixed">
          <colgroup className="hidden lg:table-column-group">
            <col />
            <col className="w-[110px] xl:w-[130px]" />
            <col className="w-[210px] xl:w-[240px]" />
            <col className="w-[244px] xl:w-[292px]" />
          </colgroup>
          <thead className="hidden lg:table-header-group">
            <tr className="border-b-[3px] border-black bg-[hsl(var(--neo-panel-muted))] text-left text-sm tracking-[0.16em] uppercase dark:border-[#0d0a19] dark:bg-[hsl(var(--neo-panel-muted))]">
              <th className="px-5 py-4 font-semibold">Repository</th>
              <th className="px-5 py-4 font-semibold">Stars</th>
              <th className="px-5 py-4 font-semibold">Last Generated</th>
              <th className="px-5 py-4 font-semibold lg:pr-6 xl:pr-7">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="block lg:table-row-group">
            {browseSkeletonRows.map((row) => (
              <tr
                key={row}
                className="block border-b border-black/15 last:border-b-0 lg:table-row dark:border-white/10"
              >
                <td className="block px-4 pt-4 lg:table-cell lg:px-5 lg:py-5">
                  <Skeleton className="h-6 w-full max-w-[32rem]" />
                </td>
                <td className="hidden px-5 py-5 lg:table-cell">
                  <Skeleton className="h-8 w-24" />
                </td>
                <td className="block px-4 pt-2 lg:table-cell lg:px-5 lg:py-5">
                  <Skeleton className="h-4 w-56 max-w-full lg:h-5 lg:w-40" />
                </td>
                <td className="block px-4 py-4 lg:table-cell lg:px-5 lg:py-5">
                  <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] xl:flex xl:gap-3 xl:whitespace-nowrap">
                    <Skeleton className="h-11 w-full lg:h-11 xl:w-40" />
                    <Skeleton className="h-11 w-full lg:h-11 xl:w-28" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-8 w-28" />
        <div className="flex gap-3">
          <Skeleton className="h-11 w-24 rounded-md" />
          <Skeleton className="h-11 w-24 rounded-md" />
        </div>
      </div>
    </div>
  );
}
