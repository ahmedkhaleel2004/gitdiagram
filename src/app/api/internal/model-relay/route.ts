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

const PROVIDERS = {
  openai: { origin: "https://api.openai.com/v1", key: "OPENAI_API_KEY" },
  meta: { origin: "https://api.meta.ai/v1", key: "META_API_KEY" },
} as const;

/**
 * Health check of the model relay (cloudflare/us-relay.ts), which for OpenAI
 * only runs for visitors in countries it refuses and so cannot be tried from
 * anywhere else: lists the provider's models (free) directly and through the
 * relay and reports the two statuses. `?provider=meta` checks Meta, whose
 * every call takes the relay; with `&stream=1` it also streams one tiny Muse
 * Ember answer through the relay (a fraction of a cent) and reports whether it
 * completed. Needs CRON_SECRET.
 */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!authorized(request))
    return Response.json(
      { ok: false, error: "Unauthorized." },
      { status: 401, headers },
    );
  const query = new URL(request.url).searchParams;
  const provider = query.get("provider") === "meta" ? "meta" : "openai";
  const { origin, key } = PROVIDERS[provider];
  const authorization = `Bearer ${process.env[key]?.trim() ?? ""}`;
  const probe = () =>
    new Request(`${origin}/models`, {
      headers: { authorization },
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
  const streamed = async () => {
    const response = relayModelRequest(
      new Request(`${origin}/responses`, {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({
          model: "muse-ember-1.0",
          input: "Say ok.",
          reasoning: { effort: "low" },
          stream: true,
        }),
        signal: AbortSignal.timeout(25_000),
      }),
    );
    if (!response) return null;
    try {
      const answer = await response;
      const text = await answer.text();
      return {
        status: answer.status,
        completed: text.includes("response.completed"),
        ...(answer.ok ? {} : { body: text.slice(0, 300) }),
      };
    } catch (error) {
      return {
        status: error instanceof Error ? error.message.slice(0, 200) : "failed",
        completed: false,
      };
    }
  };
  const [direct, relay, stream] = await Promise.all([
    status(fetch(probe())),
    status(relayModelRequest(probe())),
    provider === "meta" && query.get("stream") === "1" ? streamed() : undefined,
  ]);
  return Response.json(
    {
      ok: relay === 200 && (stream === undefined || stream?.completed === true),
      provider,
      direct,
      relay,
      ...(stream === undefined ? {} : { stream }),
    },
    { headers },
  );
}
