import { llmsFullText } from "~/features/guide/llms";
import { VIDEOS_ENABLED } from "~/lib/video-flag";

// /llms.txt plus the whole /visualize-codebase guide, in one file. Built once.
export const dynamic = "force-static";

export function GET() {
  return new Response(llmsFullText({ videos: VIDEOS_ENABLED }), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
