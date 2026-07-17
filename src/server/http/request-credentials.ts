import { cookies } from "next/headers";
import { z } from "zod";

import { isSameOriginRequest } from "~/server/http/same-origin";

export const CREDENTIAL_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const MAX_STORED_CREDENTIAL_BYTES = 2_048;

export const credentialKindSchema = z.enum(["openai_api_key", "github_pat"]);
export type CredentialKind = z.infer<typeof credentialKindSchema>;

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
}

export interface RequestCredentials {
  apiKey?: string;
  githubPat?: string;
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
  return {
    openaiApiKeyConfigured: Boolean(
      readCredential(cookieStore, "openai_api_key"),
    ),
    githubPatConfigured: Boolean(readCredential(cookieStore, "github_pat")),
  };
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
  return getStatus(cookieStore);
}

export async function clearCredential(
  kind: CredentialKind,
): Promise<CredentialStatus> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAMES[kind], "", cookieOptions(0));
  return getStatus(cookieStore);
}

export async function resolveRequestCredentials(
  request: Request,
  explicit: RequestCredentials = {},
): Promise<RequestCredentials> {
  if (!isSameOriginRequest(request)) {
    return explicit;
  }

  const cookieStore = await cookies();
  return {
    apiKey: explicit.apiKey ?? readCredential(cookieStore, "openai_api_key"),
    githubPat: explicit.githubPat ?? readCredential(cookieStore, "github_pat"),
  };
}
