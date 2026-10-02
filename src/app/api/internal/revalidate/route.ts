import { timingSafeEqual } from "node:crypto";
import { dropEdgeAnswers } from "~/server/edge-answers";
import { refreshVideoPagesHere } from "~/server/explainer/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/**
 * Drops this instance's cached pages for a repository's video. The render
 * Container (which makes videos on Cloudflare, with a Next cache of its own)
 * calls it with CRON_SECRET after storing one; see refreshVideoPages.
 */
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!authorized(request))
    return Response.json(
      { ok: false, error: "Unauthorized." },
      { status: 401, headers },
    );
  const body = (await request.json().catch(() => null)) as {
    video?: { username?: unknown; repo?: unknown };
  } | null;
  const username = body?.video?.username;
  const repo = body?.video?.repo;
  if (
    typeof username !== "string" ||
    typeof repo !== "string" ||
    !NAME.test(username) ||
    !NAME.test(repo)
  )
    return Response.json(
      { ok: false, error: "Expected { video: { username, repo } }." },
      { status: 400, headers },
    );
  refreshVideoPagesHere(username, repo);
  // The kept answer of GET /api/video for this repository (as the page asks
  // for it, and in lowercase).
  await dropEdgeAnswers(
    [
      [username, repo],
      [username.toLowerCase(), repo.toLowerCase()],
    ].map(([owner, name]) => {
      const url = new URL("/api/video", request.url);
      url.searchParams.set("username", owner!);
      url.searchParams.set("repo", name!);
      return url;
    }),
  );
  return Response.json({ ok: true }, { headers });
}
