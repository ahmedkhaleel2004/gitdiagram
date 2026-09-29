import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { GitHubConnectConfig } from "./config";

export const GITHUB_CONNECT_CALLBACK_PATH = "/api/github/callback";

const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_REQUEST_TIMEOUT_MS = 8_000;

export interface GitHubUserTokens {
  accessToken: string;
  /** Epoch ms; null when the app does not expire user tokens. */
  accessTokenExpiresAt: number | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: number | null;
}

export interface GitHubUser {
  id: number;
  login: string;
}

/** A failed code exchange or refresh, with GitHub's error code when it gave one. */
export class GitHubTokenError extends Error {
  constructor(readonly code: string) {
    super(`GitHub token request failed: ${code}`);
    this.name = "GitHubTokenError";
  }
}

export function createOAuthState(): string {
  return randomBytes(24).toString("base64url");
}

/** RFC 7636 S256: a 43-character verifier and its SHA-256 challenge. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

/**
 * GitHub's install page. With an account id it opens straight on that
 * account's repository picker, set to "Only select repositories", instead of
 * asking which account to install on.
 */
export function buildInstallUrl(appSlug: string, targetId?: number): string {
  const base = `https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new`;
  if (!targetId) return base;
  const url = new URL(`${base}/permissions`);
  url.searchParams.set("suggested_target_id", String(targetId));
  url.searchParams.set("target_id", String(targetId));
  return url.toString();
}

function toTokens(payload: Record<string, unknown>, now: number) {
  const accessToken = payload.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new GitHubTokenError(
      typeof payload.error === "string" ? payload.error : "missing_token",
    );
  }
  const seconds = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? now + value * 1000
      : null;
  return {
    accessToken,
    accessTokenExpiresAt: seconds(payload.expires_in),
    refreshToken:
      typeof payload.refresh_token === "string" && payload.refresh_token
        ? payload.refresh_token
        : null,
    refreshTokenExpiresAt: seconds(payload.refresh_token_expires_in),
  } satisfies GitHubUserTokens;
}

async function requestTokens(
  body: Record<string, string>,
): Promise<GitHubUserTokens> {
  const now = Date.now();
  let response: Response;
  try {
    response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GitHubTokenError("network_error");
  }
  if (!response.ok) {
    throw new GitHubTokenError(`http_${response.status}`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GitHubTokenError("invalid_response");
  }
  if (!payload || typeof payload !== "object") {
    throw new GitHubTokenError("invalid_response");
  }
  // GitHub answers OAuth errors with 200 and an `error` field.
  return toTokens(payload as Record<string, unknown>, now);
}

export function exchangeCodeForTokens(
  config: GitHubConnectConfig,
  params: { code: string; codeVerifier: string; redirectUri: string },
): Promise<GitHubUserTokens> {
  return requestTokens({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code: params.code,
    code_verifier: params.codeVerifier,
    redirect_uri: params.redirectUri,
  });
}

/** Refresh tokens are single use: GitHub retires the old pair on success. */
export function refreshUserTokens(
  config: GitHubConnectConfig,
  refreshToken: string,
): Promise<GitHubUserTokens> {
  return requestTokens({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export function githubApiHeaders(token?: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function fetchGitHubUser(
  accessToken: string,
): Promise<GitHubUser | null> {
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: githubApiHeaders(accessToken),
      cache: "no-store",
      signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const user = (await response.json()) as { id?: unknown; login?: unknown };
    return typeof user.id === "number" && typeof user.login === "string"
      ? { id: user.id, login: user.login }
      : null;
  } catch {
    return null;
  }
}

export type RepositoryAccess = "granted" | "missing" | "unknown";

/**
 * Whether the user's token can read the repository. A user token reaches a
 * private repository only when the app is installed on it, so "missing"
 * usually means the repository was not picked on GitHub's install page (or
 * an organization owner has not approved the install yet).
 */
export async function checkRepositoryAccess(
  accessToken: string,
  owner: string,
  repo: string,
): Promise<RepositoryAccess> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      {
        headers: githubApiHeaders(accessToken),
        cache: "no-store",
        signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
      },
    );
    if (response.ok) return "granted";
    if (response.status === 404 || response.status === 403) return "missing";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** The numeric id of a user or organization, for the targeted install page. */
export async function fetchAccountId(
  login: string,
  headers: Record<string, string> = githubApiHeaders(),
): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.github.com/users/${encodeURIComponent(login)}`,
      {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) return null;
    const account = (await response.json()) as { id?: unknown };
    return typeof account.id === "number" ? account.id : null;
  } catch {
    return null;
  }
}

/** Best effort: revokes the user access token on GitHub. */
export async function revokeUserToken(
  config: GitHubConnectConfig,
  accessToken: string,
): Promise<void> {
  try {
    await fetch(
      `https://api.github.com/applications/${encodeURIComponent(config.clientId)}/token`,
      {
        method: "DELETE",
        headers: {
          ...githubApiHeaders(),
          Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ access_token: accessToken }),
        cache: "no-store",
        signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
      },
    );
  } catch {
    // The cookie is already gone; GitHub expires the token within 8 hours.
  }
}
