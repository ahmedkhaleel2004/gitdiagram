/** A stored file of a repository's video, as served by /api/video/file. */
export type VideoFileFormat = "landscape" | "vertical" | "poster" | "still";

/** Which video a file belongs to: its repository and version (`createdAt`). */
export interface VideoFileVersion {
  owner: string;
  repo: string;
  createdAt: string;
  /** When the poster and still were made; a remade one gets a fresh URL. */
  posterAt?: number | null;
  /** A focused film's key: its files live apart from the repository's film. */
  focus?: string;
}

/**
 * Where a stored file downloads from. The version pins the exact file, so the
 * URL is immutable; pass `origin` for an absolute URL (link previews).
 */
export function videoFileUrl(
  video: VideoFileVersion,
  format: VideoFileFormat,
  origin = "",
): string {
  const params = new URLSearchParams({
    username: video.owner,
    repo: video.repo,
    format,
    v: video.createdAt,
  });
  if ((format === "poster" || format === "still") && video.posterAt)
    params.set("p", String(video.posterAt));
  if (video.focus) params.set("focus", video.focus);
  return `${origin}/api/video/file?${params.toString()}`;
}
