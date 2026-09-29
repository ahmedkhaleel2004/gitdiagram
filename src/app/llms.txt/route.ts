import { llmsText } from "~/features/guide/llms";
import { VIDEOS_ENABLED } from "~/lib/video-flag";

// https://llmstxt.org: what GitDiagram is and how agents use it. Built once.
export const dynamic = "force-static";

export function GET() {
  return new Response(llmsText({ videos: VIDEOS_ENABLED }), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
