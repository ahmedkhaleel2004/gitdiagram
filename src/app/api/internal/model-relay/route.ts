import { timingSafeEqual } from "node:crypto";
import { relayModelRequest } from "~/server/model-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/**
 * Health check of the model relay (cloudflare/us-relay.ts), which only runs
 * for visitors in countries OpenAI refuses and so cannot be tried from
 * anywhere else: lists OpenAI's models (free) directly and through the relay
 * and reports the two statuses. Needs CRON_SECRET.
 */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!authorized(request))
    return Response.json(
      { ok: false, error: "Unauthorized." },
      { status: 401, headers },
    );
  const probe = () =>
    new Request("https://api.openai.com/v1/models", {
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY?.trim() ?? ""}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
  const status = async (response: Promise<Response> | null) => {
    if (!response) return null;
    try {
      const answer = await response;
      await answer.body?.cancel();
      return answer.status;
    } catch (error) {
      return error instanceof Error ? error.message.slice(0, 200) : "failed";
    }
  };
  const [direct, relay] = await Promise.all([
    status(fetch(probe())),
    status(relayModelRequest(probe())),
  ]);
  return Response.json({ ok: relay === 200, direct, relay }, { headers });
}
