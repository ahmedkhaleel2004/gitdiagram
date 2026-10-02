import { timingSafeEqual } from "node:crypto";
import { dropEdgeAnswers } from "~/server/edge-answers";
import { refreshVideoPagesHere } from "~/server/explainer/cache";
import { revalidateBrowseIndexCache } from "~/server/browse-index-cache";
import { refreshDiagramPagesHere } from "~/server/storage/repo-page-refresh";

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

const isName = (value: unknown): value is string =>
  typeof value === "string" && NAME.test(value);

/**
 * Drops this instance's cached pages for a repository's video, or for its
 * diagram. The render Container (which makes videos on Cloudflare, with a
 * Next cache of its own) calls it with CRON_SECRET after storing a video; see
 * refreshVideoPages. `{ diagram: { username, repo } }` is for a diagram that
 * was replaced in storage from outside the site (an operator repair): it does
 * what a finished diagram run does to the caches, without an IndexNow ping.
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
    diagram?: { username?: unknown; repo?: unknown };
  } | null;
  const diagram = body?.diagram;
  if (diagram && isName(diagram.username) && isName(diagram.repo)) {
    refreshDiagramPagesHere(diagram.username, diagram.repo);
    revalidateBrowseIndexCache();
    return Response.json({ ok: true }, { headers });
  }
  const username = body?.video?.username;
  const repo = body?.video?.repo;
  if (!isName(username) || !isName(repo))
    return Response.json(
      {
        ok: false,
        error: "Expected { video: { username, repo } } or { diagram: … }.",
      },
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
