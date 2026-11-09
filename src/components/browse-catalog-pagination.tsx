"use client";

import type { MouseEvent } from "react";

interface BrowseCatalogPaginationProps {
  /**
   * The address of a page, so Previous and Next are links crawlers follow.
   * Without it they are buttons (the /videos grid is static: its server HTML
   * is the first page whatever the address says).
   */
  hrefForPage?: (page: number) => string;
  onPageChange: (nextPage: number) => void;
  page: number;
  totalPages: number;
}

const BASE_CLASS =
  "inline-flex min-h-11 items-center justify-center rounded-md px-3 py-2 text-sm font-semibold lg:px-4 lg:py-2 lg:text-sm";

/**
 * A page link that the catalog handles in place on a plain click; a
 * modified click (new tab) or a crawler follows the href.
 */
function PageLink({
  className,
  href,
  label,
  onNavigate,
}: {
  className: string;
  href: string | undefined;
  label: string;
  onNavigate: () => void;
}) {
  if (!href)
    return (
      <button type="button" onClick={onNavigate} className={className}>
        {label}
      </button>
    );
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    onNavigate();
  };
  return (
    <a href={href} onClick={handleClick} className={className}>
      {label}
    </a>
  );
}

export function BrowseCatalogPagination({
  hrefForPage,
  onPageChange,
  page,
  totalPages,
}: BrowseCatalogPaginationProps) {
  const hasPreviousPage = page > 1;
  const hasNextPage = page < totalPages;
  const previousClass = `browse-muted-button ${BASE_CLASS}`;
  const nextClass = `${BASE_CLASS} neo-button`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
        Page {page} of {totalPages}
      </p>
      <div className="flex gap-2 sm:gap-3">
        {hasPreviousPage ? (
          <PageLink
            href={hrefForPage?.(page - 1)}
            onNavigate={() => onPageChange(page - 1)}
            className={previousClass}
            label="Previous"
          />
        ) : (
          <button
            type="button"
            disabled
            className={`${previousClass} cursor-not-allowed opacity-50`}
          >
            Previous
          </button>
        )}
        {hasNextPage ? (
          <PageLink
            href={hrefForPage?.(page + 1)}
            onNavigate={() => onPageChange(page + 1)}
            className={nextClass}
            label="Next"
          />
        ) : (
          <button
            type="button"
            disabled
            className={`${BASE_CLASS} cursor-not-allowed border-[3px] border-black bg-[hsl(var(--neo-button))] opacity-50 dark:border-[#1a0d30]`}
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}
