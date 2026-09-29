import { NextResponse, type NextRequest } from "next/server";

import { getGitHubApiHeaders } from "~/server/github-auth";
import { readGitHubConnectConfig } from "~/server/github-connect/config";
import { readGitHubConnection } from "~/server/github-connect/connection";
import {
  parseRepository,
  returnUrl,
  sanitizeReturnPath,
  writeConnectFlow,
  type GitHubConnectSource,
} from "~/server/github-connect/flow";
import {
  buildAuthorizeUrl,
  buildInstallUrl,
  createOAuthState,
  createPkcePair,
  fetchAccountId,
  githubApiHeaders,
  GITHUB_CONNECT_CALLBACK_PATH,
} from "~/server/github-connect/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Continue with GitHub": starts a sign-in with the GitDiagram Private Repos
 * app. `repo` is the repository to come back to (and to check access for);
 * `install=1` goes to GitHub's install page first, for picking more
 * repositories; `from=menu` plus `return` serve the header's dialog.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const url = request.nextUrl;
  const repository = parseRepository(url.searchParams.get("repo"));
  const source: GitHubConnectSource =
    url.searchParams.get("from") === "menu" ? "menu" : "repo";
  const returnTo =
    sanitizeReturnPath(url.searchParams.get("return")) ??
    (repository ? `/${repository.full}` : "/");
  const base = { repo: repository?.full ?? null, returnTo, source };

  const config = readGitHubConnectConfig();
  if (!config) {
    return NextResponse.redirect(
      returnUrl(url.origin, base, "unavailable"),
      303,
    );
  }

  const state = createOAuthState();
  const pkce = createPkcePair();
  const install = url.searchParams.get("install") === "1";
  let destination: string;
  if (install) {
    const connection = readGitHubConnection(request.cookies);
    const targetId = repository
      ? await fetchAccountId(
          repository.owner,
          connection
            ? githubApiHeaders(connection.at)
            : await getGitHubApiHeaders().catch(() => githubApiHeaders()),
        )
      : null;
    destination = buildInstallUrl(config.appSlug, targetId ?? undefined);
  } else {
    destination = buildAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: `${url.origin}${GITHUB_CONNECT_CALLBACK_PATH}`,
      state,
      codeChallenge: pkce.challenge,
    });
  }

  const response = NextResponse.redirect(destination, 303);
  writeConnectFlow(response.cookies, {
    v: 1,
    state,
    verifier: pkce.verifier,
    ...base,
    installOffered: install,
    trips: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
