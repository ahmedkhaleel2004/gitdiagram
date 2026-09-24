"use client";

interface BrowseCatalogPaginationProps {
  onPageChange: (nextPage: number) => void;
  page: number;
  totalPages: number;
}

export function BrowseCatalogPagination({
  onPageChange,
  page,
  totalPages,
}: BrowseCatalogPaginationProps) {
  const hasPreviousPage = page > 1;
  const hasNextPage = page < totalPages;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
        Page {page} of {totalPages}
      </p>
      <div className="flex gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={!hasPreviousPage}
          className={`browse-muted-button inline-flex min-h-11 items-center justify-center rounded-md px-3 py-2 text-sm font-semibold lg:px-4 lg:py-2 lg:text-sm ${
            hasPreviousPage ? "" : "cursor-not-allowed opacity-50"
          }`}
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={!hasNextPage}
          className={`inline-flex min-h-11 items-center justify-center rounded-md px-3 py-2 text-sm font-semibold lg:px-4 lg:py-2 lg:text-sm ${
            hasNextPage
              ? "neo-button"
              : "cursor-not-allowed border-[3px] border-black bg-[hsl(var(--neo-button))] opacity-50 dark:border-[#1a0d30]"
          }`}
        >
          Next
        </button>
      </div>
    </div>
  );
}
