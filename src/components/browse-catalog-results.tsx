"use client";

import Link from "next/link";
import { ArrowRight, Clock3, Star } from "lucide-react";
import { createPortal } from "react-dom";
import type { RefObject } from "react";

import type {
  BrowsePageResult,
  BrowseIndexEntry,
} from "~/features/browse/catalog";
import { BrowseCatalogPagination } from "~/components/browse-catalog-pagination";
import { BrowseDiagramPreview } from "~/components/browse-diagram-preview";
import {
  formatGeneratedAt,
  formatGeneratedAtUtc,
  formatStarCount,
  formatStarSummary,
  HOVER_PREVIEW_WIDTH_PX,
  type HoverPreviewState,
  type HoverPreviewStatus,
} from "~/components/browse-catalog-shared";
import { SponsorCatalogRow } from "~/components/sponsor-slot";
import { useHydrated } from "~/hooks/use-hydrated";

interface BrowseCatalogResultsProps {
  closeHoverPreview: () => void;
  desktopHoverEnabled: boolean;
  handlePageChange: (nextPage: number) => void;
  handleRepoHoverMove: (
    item: BrowseIndexEntry,
    pointerPosition: { clientX: number; clientY: number },
  ) => void;
  handleRepoHoverStart: (
    item: BrowseIndexEntry,
    pointerPosition: { clientX: number; clientY: number },
  ) => void;
  hoverPreview: HoverPreviewState | null;
  hoverPreviewDiagram: string | null;
  hoverPreviewElementRef: RefObject<HTMLDivElement | null>;
  hoverPreviewStatus: HoverPreviewStatus;
  result: BrowsePageResult;
}

const totalCountFormatter = new Intl.NumberFormat("en");

function GeneratedAtTime({ value }: { value: string }) {
  const hydrated = useHydrated();

  return (
    <time dateTime={value} title={formatGeneratedAtUtc(value)}>
      <span className="block text-xs leading-snug text-[hsl(var(--neo-soft-text))] lg:text-sm lg:whitespace-nowrap dark:text-neutral-300">
        {hydrated ? formatGeneratedAt(value) : formatGeneratedAtUtc(value)}
      </span>
    </time>
  );
}

export function BrowseCatalogResults({
  closeHoverPreview,
  desktopHoverEnabled,
  handlePageChange,
  handleRepoHoverMove,
  handleRepoHoverStart,
  hoverPreview,
  hoverPreviewDiagram,
  hoverPreviewElementRef,
  hoverPreviewStatus,
  result,
}: BrowseCatalogResultsProps) {
  const showingStart =
    result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingEnd = Math.min(result.total, result.page * result.pageSize);

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
          {showingStart}–{showingEnd} of{" "}
          {totalCountFormatter.format(result.total)} public diagrams
        </p>
      </div>

      <div className="neo-panel overflow-hidden rounded-lg">
        <table className="block w-full border-collapse lg:table lg:table-fixed">
          <caption className="sr-only">Public repository diagrams</caption>
          <colgroup className="hidden lg:table-column-group">
            <col />
            <col className="w-[104px]" />
            <col className="w-[188px] xl:w-[220px]" />
            <col className="w-[280px] xl:w-[304px]" />
          </colgroup>
          <thead className="hidden lg:table-header-group">
            <tr className="border-b-[3px] border-black bg-[hsl(var(--neo-panel-muted))] text-left text-sm tracking-[0.16em] uppercase dark:border-[#0d0a19] dark:bg-[hsl(var(--neo-panel-muted))]">
              <th className="px-5 py-4 font-semibold">Repository</th>
              <th className="hidden px-5 py-4 font-semibold lg:table-cell lg:w-[104px]">
                Stars
              </th>
              <th className="w-[188px] px-5 py-4 font-semibold lg:w-[188px] xl:w-[220px]">
                Last Generated
              </th>
              <th className="w-[280px] px-5 py-4 font-semibold lg:pr-6 xl:w-[304px] xl:pr-7">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="block lg:table-row-group">
            {result.items.flatMap((item, index) => {
              const diagramPath = `/${encodeURIComponent(item.username)}/${encodeURIComponent(item.repo)}`;
              const githubPath = `https://github.com/${item.username}/${item.repo}`;

              const row = (
                <tr
                  key={`${item.username}/${item.repo}`}
                  className="block border-b border-black/15 align-middle last:border-b-0 lg:table-row dark:border-white/10"
                >
                  <td
                    className="block p-0 lg:table-cell"
                    onMouseEnter={(event) => handleRepoHoverStart(item, event)}
                    onMouseMove={(event) => handleRepoHoverMove(item, event)}
                    onMouseLeave={closeHoverPreview}
                  >
                    <div
                      title={`${item.username}/${item.repo}`}
                      className="flex h-full w-full min-w-0 flex-col px-4 pt-4 pb-2 lg:px-5 lg:py-4"
                    >
                      <span className="block text-lg leading-snug font-semibold tracking-tight [overflow-wrap:anywhere] lg:overflow-hidden lg:leading-tight lg:text-ellipsis lg:whitespace-nowrap">
                        {item.username}/{item.repo}
                      </span>
                    </div>
                  </td>
                  <td className="hidden px-5 py-4 text-sm font-semibold whitespace-nowrap lg:table-cell">
                    {formatStarCount(item.stargazerCount)}
                  </td>
                  <td className="block px-4 text-[hsl(var(--neo-soft-text))] lg:table-cell lg:px-5 lg:py-4 lg:text-sm dark:text-neutral-300">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 lg:block">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium lg:hidden">
                        <Star aria-hidden="true" className="size-3.5" />
                        {formatStarSummary(item.stargazerCount)}
                      </span>
                      <span className="inline-flex items-center gap-1.5 lg:block">
                        <Clock3
                          aria-hidden="true"
                          className="size-3.5 lg:hidden"
                        />
                        <span className="sr-only">Last generated </span>
                        <GeneratedAtTime value={item.lastSuccessfulAt} />
                      </span>
                    </div>
                  </td>
                  <td className="block px-4 py-4 lg:table-cell lg:px-5 lg:py-4 lg:pr-6 xl:px-6 xl:pr-7">
                    <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:items-center xl:flex xl:gap-3 xl:whitespace-nowrap">
                      <Link
                        href={diagramPath}
                        prefetch={false}
                        className="neo-button inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold whitespace-nowrap lg:min-h-0 lg:min-w-0 lg:px-3 lg:py-2 lg:text-sm xl:w-auto xl:min-w-[148px] xl:px-4"
                      >
                        Open Diagram
                        <ArrowRight
                          aria-hidden="true"
                          className="size-4 lg:hidden"
                        />
                      </Link>
                      <Link
                        href={githubPath}
                        className="browse-muted-button inline-flex min-h-11 w-full items-center justify-center rounded-md px-3 py-2 text-sm font-semibold whitespace-nowrap lg:min-h-0 lg:min-w-0 lg:px-3 lg:py-2 lg:text-sm xl:w-auto xl:min-w-[104px] xl:px-4"
                      >
                        GitHub
                      </Link>
                    </div>
                  </td>
                </tr>
              );
              // Its own stable key keeps the ad row mounted while searches,
              // filters, sorting and paging replace the listings around it.
              return index === 1
                ? [<SponsorCatalogRow key="sponsor" />, row]
                : [row];
            })}
          </tbody>
        </table>
      </div>

      <BrowseCatalogPagination
        onPageChange={handlePageChange}
        page={result.page}
        totalPages={result.totalPages}
      />

      {desktopHoverEnabled && hoverPreview && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={hoverPreviewElementRef}
              className="pointer-events-none fixed z-40 hidden lg:block"
              style={{
                left: 0,
                top: 0,
                transform: `translate3d(${hoverPreview.left}px, ${hoverPreview.top}px, 0)`,
                willChange: "transform",
                width: `${HOVER_PREVIEW_WIDTH_PX}px`,
              }}
            >
              <BrowseDiagramPreview
                chart={hoverPreviewDiagram}
                repoLabel={hoverPreview.repoLabel}
                status={
                  hoverPreviewStatus === "idle" ? "loading" : hoverPreviewStatus
                }
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
