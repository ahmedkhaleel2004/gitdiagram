import { recordAgentFetch } from "~/server/visibility/agent-fetch";
import { indexNowKey } from "~/server/visibility/indexnow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The IndexNow key file, served at /<key>.txt by a rewrite in next.config.js. */
export function GET(request: Request): Response {
  void recordAgentFetch(request.headers.get("user-agent"), "indexnow-key");
  const key = indexNowKey();
  return key
    ? new Response(key, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=3600, s-maxage=86400",
        },
      })
    : new Response("Not found.", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
}
