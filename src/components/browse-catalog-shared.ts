import {
  buildBrowseHref,
  normalizeBrowseQuery,
} from "~/features/browse/catalog";
import type { BrowseQuery, BrowseSort } from "~/features/browse/catalog";

export interface BrowseCatalogFilterState {
  page: number;
  q: string;
  sort: BrowseSort;
  minStars: number;
}

export type HoverPreviewStatus = "idle" | "loading" | "ready" | "error";

export interface HoverPreviewState {
  key: string;
  repoLabel: string;
  top: number;
  left: number;
}

const starCountFormatter = new Intl.NumberFormat("en");
const generatedAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export const sortOptions: Array<{ value: BrowseSort; label: string }> = [
  { value: "recent_desc", label: "Most Recent" },
  { value: "recent_asc", label: "Oldest First" },
  { value: "stars_desc", label: "Most Stars" },
  { value: "stars_asc", label: "Fewest Stars" },
  { value: "name_asc", label: "Name (A-Z)" },
];

export const minStarOptions = [
  { value: 0, label: "Any Stars" },
  { value: 10, label: "10+" },
  { value: 100, label: "100+" },
  { value: 1000, label: "1,000+" },
];

export const browseSkeletonRows = Array.from(
  { length: 6 },
  (_, index) => index,
);
export const BROWSE_SESSION_STORAGE_KEY = "gitdiagram:browse-query";
export const HOVER_PREVIEW_MEDIA_QUERY =
  "(min-width: 1024px) and (hover: hover) and (pointer: fine)";
export const HOVER_PREVIEW_WIDTH_PX = 360;
export const HOVER_PREVIEW_HEIGHT_PX = 336;
export const HOVER_PREVIEW_CURSOR_OFFSET_PX = 18;
export const HOVER_PREVIEW_OPEN_DELAY_MS = 90;

export const diagramPreviewCache = new Map<string, string>();

export function formatStarCount(stargazerCount: number | null) {
  return stargazerCount === null
    ? "—"
    : starCountFormatter.format(stargazerCount);
}

export function formatGeneratedAt(value: string) {
  return generatedAtFormatter.format(new Date(value));
}

export function formatStarSummary(stargazerCount: number | null) {
  return stargazerCount === null
    ? "No star data"
    : `${formatStarCount(stargazerCount)} stars`;
}

export function syncBrowseUrl(
  nextState: BrowseCatalogFilterState,
  mode: "push" | "replace",
) {
  const nextHref = buildBrowseHref(nextState);
  const historyMethod =
    mode === "push" ? window.history.pushState : window.history.replaceState;

  historyMethod.call(window.history, null, "", nextHref);
}

export function persistBrowseState(state: BrowseCatalogFilterState) {
  try {
    window.sessionStorage.setItem(
      BROWSE_SESSION_STORAGE_KEY,
      JSON.stringify(state),
    );
  } catch {
    // Ignore session storage failures and keep URL-based state as the fallback.
  }
}

export function readPersistedBrowseState() {
  try {
    const storedState = window.sessionStorage.getItem(
      BROWSE_SESSION_STORAGE_KEY,
    );
    if (!storedState) {
      return null;
    }

    return normalizeBrowseQuery(JSON.parse(storedState) as BrowseQuery);
  } catch {
    return null;
  }
}

export function isHistoryTraversalNavigation() {
  const [navigationEntry] = window.performance.getEntriesByType(
    "navigation",
  ) as PerformanceNavigationTiming[];

  return navigationEntry?.type === "back_forward";
}

export function getHoverPreviewPosition(pointerX: number, pointerY: number) {
  const margin = 16;
  const maxLeft = Math.max(
    margin,
    window.innerWidth - HOVER_PREVIEW_WIDTH_PX - margin,
  );
  const preferredLeft = pointerX + HOVER_PREVIEW_CURSOR_OFFSET_PX;
  const fallbackLeft =
    pointerX - HOVER_PREVIEW_WIDTH_PX - HOVER_PREVIEW_CURSOR_OFFSET_PX;
  const left =
    preferredLeft <= maxLeft
      ? preferredLeft
      : Math.min(maxLeft, Math.max(margin, fallbackLeft));
  const maxTop = Math.max(
    margin,
    window.innerHeight - HOVER_PREVIEW_HEIGHT_PX - margin,
  );
  const preferredTop = pointerY + HOVER_PREVIEW_CURSOR_OFFSET_PX;
  const fallbackTop =
    pointerY - HOVER_PREVIEW_HEIGHT_PX - HOVER_PREVIEW_CURSOR_OFFSET_PX;

  return {
    left,
    top:
      preferredTop <= maxTop
        ? preferredTop
        : Math.min(maxTop, Math.max(margin, fallbackTop)),
  };
}
