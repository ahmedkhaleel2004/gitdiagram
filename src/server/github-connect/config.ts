import "server-only";

/**
 * "Continue with GitHub" runs on its own GitHub App ("GitDiagram Private
 * Repos"), separate from the app whose installation token reads public
 * repositories. That app's private key lives on the server, and any
 * installation of it could be read with that key alone. This app only ever
 * uses its client id and secret: the server can read a private repository
 * only with the visitor's own user token, sent with that visitor's request.
 */
export interface GitHubConnectConfig {
  clientId: string;
  clientSecret: string;
  appSlug: string;
}

function readTrimmedEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function readGitHubConnectConfig(): GitHubConnectConfig | null {
  const clientId = readTrimmedEnv("GITHUB_CONNECT_CLIENT_ID");
  const clientSecret = readTrimmedEnv("GITHUB_CONNECT_CLIENT_SECRET");
  const appSlug = readTrimmedEnv("GITHUB_CONNECT_APP_SLUG");
  if (!clientId || !clientSecret || !appSlug) return null;
  return { clientId, clientSecret, appSlug };
}
