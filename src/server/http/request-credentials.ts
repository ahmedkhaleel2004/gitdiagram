import { cookies } from "next/headers";
import { z } from "zod";

import {
  clearGitHubConnection,
  readGitHubConnection,
  resolveGitHubConnection,
  type CookieWriter,
} from "~/server/github-connect/connection";
import { isSameOriginRequest } from "~/server/http/same-origin";

export const CREDENTIAL_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const MAX_STORED_CREDENTIAL_BYTES = 2_048;

export const credentialKindSchema = z.enum(["openai_api_key", "github_pat"]);
export type CredentialKind = z.infer<typeof credentialKindSchema>;
/** Everything a visitor can clear: the pasted secrets and a GitHub sign-in. */
export const clearableCredentialSchema = z.enum([
  ...credentialKindSchema.options,
  "github_app",
]);
export type ClearableCredential = z.infer<typeof clearableCredentialSchema>;

export const storedCredentialSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_STORED_CREDENTIAL_BYTES)
  .refine(
    (value) =>
      new TextEncoder().encode(value).byteLength <= MAX_STORED_CREDENTIAL_BYTES,
  );

export interface CredentialStatus {
  openaiApiKeyConfigured: boolean;
  githubPatConfigured: boolean;
  /** Signed in with "Continue with GitHub" (the GitDiagram Private Repos app). */
  githubAppConnected: boolean;
  githubLogin: string | null;
}

export interface RequestCredentials {
  apiKey?: string;
  /** The GitHub token for API calls: a pasted token or a GitHub sign-in's. */
  githubPat?: string;
  /**
   * What the caller's private diagrams are stored under. A pasted token is
   * its own key; a GitHub sign-in uses its account id, which outlives the
   * 8-hour token.
   */
  githubStorageKey?: string;
}

const COOKIE_NAMES: Record<CredentialKind, string> = {
  openai_api_key: "gitdiagram_openai_api_key",
  github_pat: "gitdiagram_github_pat",
};

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/api",
    maxAge,
  };
}

function readCredential(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  kind: CredentialKind,
): string | undefined {
  const parsed = storedCredentialSchema.safeParse(
    cookieStore.get(COOKIE_NAMES[kind])?.value,
  );
  return parsed.success ? parsed.data : undefined;
}

function getStatus(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
): CredentialStatus {
  const connection = readGitHubConnection(cookieStore);
  return {
    openaiApiKeyConfigured: Boolean(
      readCredential(cookieStore, "openai_api_key"),
    ),
    githubPatConfigured: Boolean(readCredential(cookieStore, "github_pat")),
    githubAppConnected: Boolean(connection),
    githubLogin: connection?.login ?? null,
  };
}

/** Removes a pasted credential's cookie through any cookie writer. */
export function clearStoredCredential(
  cookieStore: CookieWriter,
  kind: CredentialKind,
): void {
  cookieStore.set(COOKIE_NAMES[kind], "", cookieOptions(0));
}

export async function getCredentialStatus(): Promise<CredentialStatus> {
  return getStatus(await cookies());
}

export async function setCredential(
  kind: CredentialKind,
  value: string,
): Promise<CredentialStatus> {
  const cookieStore = await cookies();
  const credential = storedCredentialSchema.parse(value);
  cookieStore.set(
    COOKIE_NAMES[kind],
    credential,
    cookieOptions(CREDENTIAL_COOKIE_MAX_AGE_SECONDS),
  );
  // One GitHub credential at a time: the one set last is the one used.
  if (kind === "github_pat") clearGitHubConnection(cookieStore);
  return getStatus(cookieStore);
}

export async function clearCredential(
  kind: ClearableCredential,
): Promise<CredentialStatus> {
  const cookieStore = await cookies();
  if (kind === "github_app") {
    clearGitHubConnection(cookieStore);
  } else {
    clearStoredCredential(cookieStore, kind);
  }
  return getStatus(cookieStore);
}

/** The sign-in's current access token, so a disconnect can revoke it. */
export async function readGitHubConnectionToken(): Promise<string | null> {
  return readGitHubConnection(await cookies())?.at ?? null;
}

export async function resolveRequestCredentials(
  request: Request,
  explicit: RequestCredentials = {},
): Promise<RequestCredentials> {
  if (!isSameOriginRequest(request)) {
    return {
      ...explicit,
      githubStorageKey: explicit.githubStorageKey ?? explicit.githubPat,
    };
  }

  const cookieStore = await cookies();
  const apiKey =
    explicit.apiKey ?? readCredential(cookieStore, "openai_api_key");
  const githubPat =
    explicit.githubPat ?? readCredential(cookieStore, "github_pat");
  if (githubPat) {
    return { apiKey, githubPat, githubStorageKey: githubPat };
  }

  const connection = await resolveGitHubConnection(cookieStore);
  return connection
    ? {
        apiKey,
        githubPat: connection.token,
        githubStorageKey: connection.storageKey,
      }
    : { apiKey, githubPat: undefined };
}
