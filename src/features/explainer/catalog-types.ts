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
