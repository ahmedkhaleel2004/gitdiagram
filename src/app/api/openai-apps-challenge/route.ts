import { upstashCommand } from "~/server/storage/upstash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where the operator can put the token without a redeploy (plain SET). */
const CHALLENGE_REDIS_KEY = "openai:v1:apps-challenge";

const isToken = (value: unknown): value is string =>
  typeof value === "string" && /^[\w.-]{8,512}$/.test(value);

async function readToken(): Promise<string | null> {
  const fromEnv = process.env.OPENAI_APPS_CHALLENGE?.trim();
  if (isToken(fromEnv)) return fromEnv;
  try {
    const stored = await upstashCommand<string | null>([
      "GET",
      CHALLENGE_REDIS_KEY,
    ]);
    const trimmed = stored?.trim();
    return isToken(trimmed) ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * OpenAI's plugin portal checks that the MCP server's domain is ours by
 * reading the token it shows at /.well-known/openai-apps-challenge (a rewrite
 * in next.config.js). The token is public: set OPENAI_APPS_CHALLENGE, or the
 * Redis key above to skip a redeploy.
 */
export async function GET(): Promise<Response> {
  const token = await readToken();
  return token
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
