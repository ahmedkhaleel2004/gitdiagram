import "server-only";

import { createHash, createHmac } from "node:crypto";
import { z } from "zod";

import { readRequiredEnv } from "~/server/storage/config";

import { readGitHubConnectConfig } from "./config";
import {
  refreshUserTokens,
  type GitHubUser,
  type GitHubUserTokens,
} from "./oauth";
import { seal, unseal } from "./seal";

/**
 * A "Continue with GitHub" sign-in lives only in this browser cookie, the
 * same way a pasted token does: HttpOnly, SameSite=Strict, sent only to
 * /api, and never written to server storage. It is also sealed (encrypted
 * with a server key), so the browser cannot read the tokens inside it or
 * swap in another GitHub account's id.
 */
export const GITHUB_CONNECTION_COOKIE = "gitdiagram_github_connection";
const GITHUB_CONNECTION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const SEAL_PURPOSE = "github-connection";
/** Refresh a little early so a token cannot expire in the middle of a run. */
const REFRESH_MARGIN_MS = 5 * 60_000;
/**
 * Refresh tokens are single use. Parallel requests from one browser on one
 * instance share a single refresh (and its result, briefly, in memory only)
 * instead of racing and retiring each other's tokens.
 */
const REFRESH_REUSE_MS = 30_000;

const connectionSchema = z.strictObject({
  v: z.literal(1),
  uid: z.number().int().positive(),
  login: z.string().min(1).max(39),
  at: z.string().min(1).max(512),
  atx: z.number().nullable(),
  rt: z.string().min(1).max(512).nullable(),
  rtx: z.number().nullable(),
});

export type GitHubConnection = z.infer<typeof connectionSchema>;

interface CookieOptions {
  httpOnly: boolean;
  sameSite: "strict" | "lax";
  secure: boolean;
  path: string;
  maxAge: number;
}

export interface CookieReader {
  get(name: string): { value: string } | undefined;
}

export interface CookieWriter {
  set(name: string, value: string, options: CookieOptions): unknown;
}

function connectionCookieOptions(maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/api",
    maxAge,
  };
}

export function readGitHubConnection(
  cookies: CookieReader,
): GitHubConnection | null {
  return unseal(
    SEAL_PURPOSE,
    cookies.get(GITHUB_CONNECTION_COOKIE)?.value,
    connectionSchema,
  );
}

export function toGitHubConnection(
  user: GitHubUser,
  tokens: GitHubUserTokens,
): GitHubConnection {
  return {
    v: 1,
    uid: user.id,
    login: user.login,
    at: tokens.accessToken,
    atx: tokens.accessTokenExpiresAt,
    rt: tokens.refreshToken,
    rtx: tokens.refreshTokenExpiresAt,
  };
}

export function writeGitHubConnection(
  cookies: CookieWriter,
  connection: GitHubConnection,
  now = Date.now(),
): void {
  const refreshSecondsLeft =
    connection.rtx === null
      ? Number.POSITIVE_INFINITY
      : Math.floor((connection.rtx - now) / 1000);
  const maxAge = Math.max(
    0,
    Math.min(GITHUB_CONNECTION_MAX_AGE_SECONDS, refreshSecondsLeft),
  );
  cookies.set(
    GITHUB_CONNECTION_COOKIE,
    seal(SEAL_PURPOSE, connection),
    connectionCookieOptions(maxAge),
  );
}

export function clearGitHubConnection(cookies: CookieWriter): void {
  cookies.set(GITHUB_CONNECTION_COOKIE, "", connectionCookieOptions(0));
}

/**
 * Private diagrams are stored under a namespace derived from this key. A
 * pasted token is its own key; a GitHub sign-in uses the account id, so its
 * diagrams survive the 8-hourly token refresh and a later reconnect. Only a
 * sealed cookie can carry an account id, and only the OAuth callback seals one.
 */
/**
 * Where a sign-in's private diagrams are stored. It stands in for a token in
 * the private namespace (cache-key.ts HMACs it again), and a pasted "token"
 * can be any string, so it must not be guessable from the public account id:
 * it is keyed with the server secret, never `github-user:<id>`.
 */
export function githubConnectionStorageKey(userId: number): string {
  return createHmac("sha256", readRequiredEnv("CACHE_KEY_SECRET"))
    .update(`gitdiagram:github-account-storage:v1:${userId}`)
    .digest("hex");
}

const recentRefreshes = new Map<
  string,
  { promise: Promise<GitHubUserTokens | null>; expiresAt: number }
>();

function refreshOnce(refreshToken: string): Promise<GitHubUserTokens | null> {
  const now = Date.now();
  for (const [key, entry] of recentRefreshes) {
    if (entry.expiresAt <= now) recentRefreshes.delete(key);
  }

  const key = createHash("sha256").update(refreshToken).digest("hex");
  const existing = recentRefreshes.get(key);
  if (existing) return existing.promise;

  const config = readGitHubConnectConfig();
  const promise = config
    ? refreshUserTokens(config, refreshToken).catch((error: unknown) => {
        console.error(
          JSON.stringify({
            event: "github_connect.refresh_failed",
            error: error instanceof Error ? error.message : "unknown",
          }),
        );
        return null;
      })
    : Promise.resolve(null);
  recentRefreshes.set(key, { promise, expiresAt: now + REFRESH_REUSE_MS });
  return promise;
}

export function resetGitHubConnectionRefreshesForTests(): void {
  recentRefreshes.clear();
}

export interface ResolvedGitHubConnection {
  token: string;
  storageKey: string;
  login: string;
}

/**
 * The connection's usable access token, refreshing it (and re-sealing the
 * cookie) when it is about to expire. A refresh that fails leaves the cookie
 * alone: another request may have just refreshed it, and a truly revoked
 * sign-in surfaces as the usual "needs GitHub access" prompt.
 */
export async function resolveGitHubConnection(
  cookies: CookieReader & CookieWriter,
  now = Date.now(),
): Promise<ResolvedGitHubConnection | null> {
  const connection = readGitHubConnection(cookies);
  if (!connection) return null;
  const storageKey = githubConnectionStorageKey(connection.uid);

  const needsRefresh =
    connection.atx !== null && connection.atx - now < REFRESH_MARGIN_MS;
  if (!needsRefresh) {
    return { token: connection.at, storageKey, login: connection.login };
  }

  const canRefresh =
    connection.rt !== null && (connection.rtx === null || connection.rtx > now);
  if (canRefresh && connection.rt) {
    const tokens = await refreshOnce(connection.rt);
    if (tokens) {
      const refreshed = {
        ...connection,
        at: tokens.accessToken,
        atx: tokens.accessTokenExpiresAt,
        rt: tokens.refreshToken ?? connection.rt,
        rtx: tokens.refreshTokenExpiresAt ?? connection.rtx,
      };
      try {
        writeGitHubConnection(cookies, refreshed, now);
      } catch {
        // Cookies are read-only outside a route handler; use the token anyway.
      }
      return { token: refreshed.at, storageKey, login: connection.login };
    }
  } else if (connection.atx !== null && connection.atx <= now) {
    try {
      clearGitHubConnection(cookies);
    } catch {
      // Read-only cookie context.
    }
    return null;
  }

  // Refresh failed: the old token still works until it actually expires.
  return connection.atx !== null && connection.atx > now
    ? { token: connection.at, storageKey, login: connection.login }
    : null;
}
