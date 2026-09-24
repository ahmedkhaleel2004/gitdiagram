import "server-only";

import type { VideoArtifact } from "~/features/explainer/types";
import { renderExplainerPoster } from "./render";
import { writeRender } from "./store";

/**
 * Render and store a video's link-preview still. Never throws: a missing
 * poster only means previews fall back to the repository's image.
 */
export async function storePoster(artifact: VideoArtifact, origin: string) {
  const started = Date.now();
  try {
    const poster = await renderExplainerPoster({ artifact, origin });
    await writeRender(artifact, "poster.jpg", poster);
    console.info(
      JSON.stringify({
        event: "video.poster.stored",
        repository: artifact.repository,
        ms: Date.now() - started,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "video.poster.failed",
        repository: artifact.repository,
        error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
      }),
    );
  }
}
