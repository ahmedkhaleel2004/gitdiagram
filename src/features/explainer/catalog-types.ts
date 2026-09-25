import type { BrowsePageResult } from "~/features/browse/catalog";

/** What a video card on /videos shows. */
export interface VideoCard {
  owner: string;
  repo: string;
  title: string;
  /** The first line of narration: what the project is. */
  opening: string;
  durationSeconds: number;
  stars: number;
  language: string;
  createdAt: string;
  /**
   * When the poster and still were last made (ms), if known. Poster URLs
   * carry it, so a remade still is fetched fresh past every cache.
   */
  posterAt?: number;
}

/** Cards per /videos page: divides evenly into the grid's two, three and four columns. */
export const VIDEO_PAGE_SIZE = 24;

/** One page of the /videos gallery, with the query that made it. */
export type VideoPage = Omit<BrowsePageResult, "items"> & {
  cards: VideoCard[];
};
