import { createSign } from "node:crypto";

const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_APP_JWT_LIFETIME_SECONDS = 9 * 60;
const GITHUB_APP_TOKEN_REFRESH_BUFFER_MS = 60_000;
const GITHUB_APP_TOKEN_TIMEOUT_MS = 10_000;

interface InstallationTokenResponse {
  token?: string;
  expires_at?: string;
}

let cachedInstallationToken: {
  token: string;
  expiresAtMs: number;
} | null = null;
let installationTokenPromise: Promise<string> | null = null;

function readTrimmedEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function toBase64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function createGitHubAppJwt() {
  const privateKey = readTrimmedEnv("GITHUB_PRIVATE_KEY");
  const issuer =
    readTrimmedEnv("GITHUB_APP_ID") ?? readTrimmedEnv("GITHUB_CLIENT_ID");

  if (!privateKey || !issuer) {
    throw new Error(
      "Missing GitHub App credentials. Set GITHUB_PRIVATE_KEY and GITHUB_APP_ID or GITHUB_CLIENT_ID.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = toBase64Url(
    JSON.stringify({
      iat: now - 60,
      exp: now + GITHUB_APP_JWT_LIFETIME_SECONDS,
      iss: issuer,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = signer.sign(privateKey, "base64url");

  return `${header}.${payload}.${signature}`;
}

function hasGitHubAppAuth() {
  return Boolean(
    readTrimmedEnv("GITHUB_PRIVATE_KEY") &&
    (readTrimmedEnv("GITHUB_APP_ID") || readTrimmedEnv("GITHUB_CLIENT_ID")) &&
    readTrimmedEnv("GITHUB_INSTALLATION_ID"),
  );
}

export function readGitHubPatPool() {
  const tokenPool = (process.env.GITHUB_PATS ?? "")
    .split(/[,\n]/u)
    .map((token) => token.trim())
    .filter(Boolean);

  const singleToken = readTrimmedEnv("GITHUB_PAT");
  if (singleToken) {
    tokenPool.push(singleToken);
  }

  return Array.from(new Set(tokenPool));
}

async function requestGitHubAppInstallationToken() {
  const installationId = readTrimmedEnv("GITHUB_INSTALLATION_ID");
  if (!installationId || !hasGitHubAppAuth()) {
    throw new Error("Missing GitHub App installation auth configuration.");
  }

  const timeoutSignal = AbortSignal.timeout(GITHUB_APP_TOKEN_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createGitHubAppJwt()}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
        cache: "no-store",
        signal: timeoutSignal,
      },
    );
  } catch (error) {
    if (timeoutSignal.aborted) {
      throw new Error("GitHub App token request timed out. Please retry.");
    }
    throw error;
  }

  if (!response.ok) {
    throw new Error(
      `Failed to create GitHub App installation token (${response.status}): ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as InstallationTokenResponse;
  if (!payload.token) {
    throw new Error(
      "GitHub App installation token response did not include a token.",
    );
  }

  cachedInstallationToken = {
    token: payload.token,
    expiresAtMs: payload.expires_at
      ? Date.parse(payload.expires_at)
      : Date.now() + 55 * 60_000,
  };

  return cachedInstallationToken.token;
}

async function getGitHubAppInstallationToken() {
  if (
    cachedInstallationToken &&
    cachedInstallationToken.expiresAtMs - Date.now() >
      GITHUB_APP_TOKEN_REFRESH_BUFFER_MS
  ) {
    return cachedInstallationToken.token;
  }

  installationTokenPromise ??= requestGitHubAppInstallationToken().finally(
    () => {
      installationTokenPromise = null;
    },
  );
  return installationTokenPromise;
}

export async function getGitHubApiHeaders(options?: {
  githubPat?: string;
  allowGitHubAppAuth?: boolean;
}) {
  const githubPat = options?.githubPat?.trim();
  const allowGitHubAppAuth = options?.allowGitHubAppAuth ?? true;
  const token =
    githubPat ||
    (allowGitHubAppAuth && hasGitHubAppAuth()
      ? await getGitHubAppInstallationToken()
      : (readGitHubPatPool()[0] ?? null));

  if (!token) {
    return {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    } as Record<string, string>;
  }

  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  } as Record<string, string>;
}
