import "server-only";

import type { VideoArtifact } from "~/features/explainer/types";
import { renderExplainerPoster } from "./render";
import { writeRender } from "./store";

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
    const { poster, still } = await renderExplainerPoster({ artifact, origin });
    await Promise.all([
      writeRender(artifact, "poster.jpg", poster),
      writeRender(artifact, "still.jpg", still),
    ]);
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
      }),
    );
    return false;
  }
}
