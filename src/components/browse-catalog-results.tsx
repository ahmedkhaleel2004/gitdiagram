"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import type { RefObject } from "react";

import type {
  BrowseIndexEntry,
  getBrowsePageFromEntries,
} from "~/features/browse/catalog";
import { BrowseDiagramPreview } from "~/components/browse-diagram-preview";
import {
  formatGeneratedAt,
  formatStarCount,
  formatStarSummary,
  HOVER_PREVIEW_WIDTH_PX,
  type HoverPreviewState,
  type HoverPreviewStatus,
} from "~/components/browse-catalog-shared";

type BrowsePageResult = NonNullable<
  ReturnType<typeof getBrowsePageFromEntries>
>;

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
  const hasPreviousPage = result.page > 1;
  const hasNextPage = result.page < result.totalPages;

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-base text-[hsl(var(--neo-soft-text))] lg:text-sm dark:text-neutral-300">
          Showing {showingStart}-{showingEnd} of{" "}
          {totalCountFormatter.format(result.total)} public diagrams
        </p>
      </div>

      <div className="neo-panel overflow-hidden rounded-lg">
        <div className="border-b-[3px] border-black bg-[hsl(var(--neo-panel-muted))] px-4 py-3 text-left text-xs font-semibold tracking-[0.18em] uppercase lg:hidden dark:border-[#0d0a19] dark:bg-[hsl(var(--neo-panel-muted))]">
          Repository Results
        </div>
        <table className="w-full border-collapse lg:table-fixed">
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
            {result.items.map((item) => {
              const diagramPath = `/${encodeURIComponent(item.username)}/${encodeURIComponent(item.repo)}`;
              const githubPath = `https://github.com/${item.username}/${item.repo}`;

              return (
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
                      className="flex h-full w-full flex-col px-4 pt-5 pb-5 lg:px-5 lg:py-4"
                    >
                      <span className="block text-[1.4rem] leading-[1.05] font-semibold tracking-tight break-all lg:overflow-hidden lg:text-lg lg:leading-tight lg:break-normal lg:text-ellipsis lg:whitespace-nowrap">
                        {item.username}/{item.repo}
                      </span>
                      <span className="mt-3 block lg:hidden">
                        <span className="inline-flex items-center rounded-full border-[2px] border-black bg-black/5 px-3 py-1 text-sm font-semibold dark:border-[#1a0d30] dark:bg-white/5">
                          {formatStarSummary(item.stargazerCount)}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="hidden px-5 py-4 text-sm font-semibold whitespace-nowrap lg:table-cell">
                    {formatStarCount(item.stargazerCount)}
                  </td>
                  <td className="block px-4 pt-4 text-[hsl(var(--neo-soft-text))] lg:table-cell lg:px-5 lg:py-4 lg:text-sm dark:text-neutral-300">
                    <span className="block text-[11px] font-semibold tracking-[0.18em] text-[hsl(var(--neo-soft-text))] uppercase lg:hidden dark:text-neutral-400">
                      Last Generated
                    </span>
                    <time dateTime={item.lastSuccessfulAt}>
                      <span className="mt-2 block text-base leading-snug font-medium text-[hsl(var(--foreground))] lg:mt-0 lg:text-sm lg:font-normal lg:whitespace-nowrap lg:text-[hsl(var(--neo-soft-text))] dark:text-[hsl(var(--foreground))] lg:dark:text-neutral-300">
                        {formatGeneratedAt(item.lastSuccessfulAt)}
                      </span>
                    </time>
                  </td>
                  <td className="block px-4 py-4 lg:table-cell lg:px-5 lg:py-4 lg:pr-6 xl:px-6 xl:pr-7">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:items-center xl:flex xl:gap-3 xl:whitespace-nowrap">
                      <Link
                        href={diagramPath}
                        className="neo-button inline-flex min-h-[52px] w-full items-center justify-center rounded-md px-4 py-3 text-base font-semibold whitespace-nowrap lg:min-h-0 lg:min-w-0 lg:px-3 lg:py-2 lg:text-sm xl:w-auto xl:min-w-[148px] xl:px-4"
                      >
                        Open Diagram
                      </Link>
                      <Link
                        href={githubPath}
                        className="browse-muted-button inline-flex min-h-[52px] w-full items-center justify-center rounded-md px-4 py-3 text-base font-semibold whitespace-nowrap lg:min-h-0 lg:min-w-0 lg:px-3 lg:py-2 lg:text-sm xl:w-auto xl:min-w-[104px] xl:px-4"
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-base text-[hsl(var(--neo-soft-text))] lg:text-sm dark:text-neutral-300">
          Page {result.page} of {result.totalPages}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => handlePageChange(result.page - 1)}
            disabled={!hasPreviousPage}
            className={`browse-muted-button inline-flex items-center rounded-md px-5 py-3 text-base font-semibold lg:px-4 lg:py-2 lg:text-sm ${
              hasPreviousPage ? "" : "cursor-not-allowed opacity-50"
            }`}
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => handlePageChange(result.page + 1)}
            disabled={!hasNextPage}
            className={`inline-flex items-center rounded-md px-5 py-3 text-base font-semibold lg:px-4 lg:py-2 lg:text-sm ${
              hasNextPage
                ? "neo-button"
                : "cursor-not-allowed border-[3px] border-black bg-[hsl(var(--neo-button))] opacity-50 dark:border-[#1a0d30]"
            }`}
          >
            Next
          </button>
        </div>
      </div>

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
