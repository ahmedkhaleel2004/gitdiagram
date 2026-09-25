/**
 * Whether this deployment shows explainer videos (the Video toggle, /videos
 * and its links). NEXT_PUBLIC_VIDEO_EXPLAINER is inlined at build time, so the
 * pages and the browser agree; the API routes check the server's own switch,
 * VIDEO_EXPLAINER_ENABLED (src/server/explainer/config.ts).
 */
export const VIDEOS_ENABLED = process.env.NEXT_PUBLIC_VIDEO_EXPLAINER === "1";
