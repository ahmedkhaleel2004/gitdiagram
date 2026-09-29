import "server-only";

import { z } from "zod";

import {
  githubRepoSchema,
  githubUsernameSchema,
} from "~/server/generate/types";

import type { CookieReader, CookieWriter } from "./connection";
import { seal, unseal } from "./seal";

/**
 * One sign-in attempt, from "Continue with GitHub" to the callback: the
 * OAuth state, the PKCE verifier, and where to send the visitor back. Sealed,
 * HttpOnly, only sent to /api/github, and gone after ten minutes. SameSite
 * is Lax because GitHub's redirect back is a cross-site navigation, which
 * Strict cookies do not ride along with.
 */
export const GITHUB_CONNECT_FLOW_COOKIE = "gitdiagram_github_connect";
const SEAL_PURPOSE = "github-connect-flow";
const FLOW_MAX_AGE_SECONDS = 10 * 60;
/** Bounds the silent authorize/install round trips of one attempt. */
export const MAX_FLOW_ROUND_TRIPS = 4;

export type GitHubConnectSource = "repo" | "menu";

const flowSchema = z.strictObject({
  v: z.literal(1),
  state: z.string().min(16).max(128),
  verifier: z.string().min(43).max(128),
  repo: z.string().max(140).nullable(),
  returnTo: z.string().min(1).max(512),
  source: z.enum(["repo", "menu"]),
  installOffered: z.boolean(),
  trips: z.number().int().min(0).max(20),
});

export type GitHubConnectFlow = z.infer<typeof flowSchema>;

function flowCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/api/github",
    maxAge,
  };
}

export function readConnectFlow(
  cookies: CookieReader,
): GitHubConnectFlow | null {
  return unseal(
    SEAL_PURPOSE,
    cookies.get(GITHUB_CONNECT_FLOW_COOKIE)?.value,
    flowSchema,
  );
}

export function writeConnectFlow(
  cookies: CookieWriter,
  flow: GitHubConnectFlow,
): void {
  cookies.set(
    GITHUB_CONNECT_FLOW_COOKIE,
    seal(SEAL_PURPOSE, flow),
    flowCookieOptions(FLOW_MAX_AGE_SECONDS),
  );
}

export function clearConnectFlow(cookies: CookieWriter): void {
  cookies.set(GITHUB_CONNECT_FLOW_COOKIE, "", flowCookieOptions(0));
}

/** "owner/repo" when both halves are valid GitHub names, else null. */
export function parseRepository(
  value: string | null,
): { owner: string; repo: string; full: string } | null {
  if (!value) return null;
  const [owner, repo, ...rest] = value.split("/");
  if (rest.length) return null;
  const parsedOwner = githubUsernameSchema.safeParse(owner);
  const parsedRepo = githubRepoSchema.safeParse(repo);
  if (!parsedOwner.success || !parsedRepo.success) return null;
  const full = `${parsedOwner.data.toLowerCase()}/${parsedRepo.data.toLowerCase()}`;
  return { owner: parsedOwner.data, repo: parsedRepo.data, full };
}

/**
 * A same-site path to come back to, or null. Rejects anything that could
 * leave the site ("//host", "/\\host", absolute URLs) and drops an earlier
 * attempt's result parameters.
 */
export function sanitizeReturnPath(value: string | null): string | null {
  if (!value || value.length > 512) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  let url: URL;
  try {
    url = new URL(value, "https://gitdiagram.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://gitdiagram.invalid") return null;
  if (url.pathname.startsWith("/api/")) return null;
  url.searchParams.delete("github");
  url.searchParams.delete("github_from");
  return `${url.pathname}${url.search}`;
}

/** Where the visitor lands after an attempt, with its outcome attached. */
export function returnUrl(
  origin: string,
  flow: Pick<GitHubConnectFlow, "returnTo" | "source">,
  result: string,
): URL {
  const url = new URL(flow.returnTo, origin);
  url.searchParams.set("github", result);
  if (flow.source === "menu") url.searchParams.set("github_from", "menu");
  return url;
}
