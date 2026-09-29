export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OpenAI's plugin portal checks that the MCP server's domain is ours by
 * reading the token it shows at /.well-known/openai-apps-challenge (a rewrite
 * in next.config.js). The token is public; set it in OPENAI_APPS_CHALLENGE.
 */
export function GET(): Response {
  const token = process.env.OPENAI_APPS_CHALLENGE?.trim() ?? "";
  return /^[\w.-]{8,512}$/.test(token)
    ? new Response(token, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      })
    : new Response("Not found.", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
}
