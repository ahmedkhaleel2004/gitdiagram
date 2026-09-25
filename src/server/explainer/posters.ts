import "server-only";

import type { VideoArtifact } from "~/features/explainer/types";
import { renderExplainerPoster, renderHostStats } from "./render";
import { videoStoreBackend, writeRender } from "./store";
import { indexVideo } from "./video-index";

/**
 * Render and store a video's link-preview still; resolves whether it worked.
 * Never throws: a missing poster only means previews fall back to the
 * repository's image.
 */
export async function storePoster(
  artifact: VideoArtifact,
  origin: string,
): Promise<boolean> {
  const started = Date.now();
  try {
    // Chromium now and then crashes mid-render; a fresh one usually works.
    const render = () => renderExplainerPoster({ artifact, origin });
    const { poster, still } = await render().catch(render);
    await Promise.all([
      writeRender(artifact, "poster.jpg", poster),
      writeRender(artifact, "still.jpg", still),
    ]);
    // The gallery card names the still by when it was made, so a remake is
    // fetched fresh rather than from a cache that kept the old one.
    if (videoStoreBackend() === "r2")
      await indexVideo(artifact, { posterAt: Date.now() });
    console.info(
      JSON.stringify({
        event: "video.poster.stored",
        repository: artifact.repository,
        ms: Date.now() - started,
      }),
    );
    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "video.poster.failed",
        repository: artifact.repository,
        error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
        host: await renderHostStats(),
      }),
    );
    return false;
  }
}
