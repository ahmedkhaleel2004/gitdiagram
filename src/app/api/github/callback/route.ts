import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { readGitHubConnectConfig } from "~/server/github-connect/config";
import {
  toGitHubConnection,
  writeGitHubConnection,
} from "~/server/github-connect/connection";
import {
  clearConnectFlow,
  MAX_FLOW_ROUND_TRIPS,
  parseRepository,
  readConnectFlow,
  returnUrl,
  writeConnectFlow,
  type GitHubConnectFlow,
} from "~/server/github-connect/flow";
import {
  buildAuthorizeUrl,
  buildInstallUrl,
  checkRepositoryAccess,
  createOAuthState,
  createPkcePair,
  exchangeCodeForTokens,
  fetchAccountId,
  fetchGitHubUser,
  githubApiHeaders,
  GITHUB_CONNECT_CALLBACK_PATH,
  GitHubTokenError,
} from "~/server/github-connect/oauth";
import { clearStoredCredential } from "~/server/http/request-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function statesMatch(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function redirect(destination: string | URL): NextResponse {
  const response = NextResponse.redirect(destination, 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function log(event: string, fields: Record<string, unknown>) {
  console.info(JSON.stringify({ event: `github_connect.${event}`, ...fields }));
}

/**
 * GitHub sends the visitor back here after authorizing (with `code` and our
 * `state`) and after its install page (with `installation_id` and
 * `setup_action`, and no state). A code is only ever exchanged when its state
 * matches this browser's sealed flow cookie, with that flow's PKCE verifier.
 * After an install the visitor is sent through authorize once more, which
 * GitHub passes straight through for an app they have already authorized.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const url = request.nextUrl;
  const params = url.searchParams;
  const origin = url.origin;
  const redirectUri = `${origin}${GITHUB_CONNECT_CALLBACK_PATH}`;
  const flow = readConnectFlow(request.cookies);
  const returningFromInstall =
    params.has("installation_id") || params.has("setup_action");

  if (!flow) {
    log("failed", { reason: "expired" });
    // Installed straight from GitHub's app page: nothing to report.
    return redirect(
      returningFromInstall
        ? new URL("/", origin)
        : returnUrl(origin, { returnTo: "/", source: "menu" }, "expired"),
    );
  }

  const fail = (reason: string) => {
    log("failed", { reason, trips: flow.trips });
    const response = redirect(returnUrl(origin, flow, reason));
    clearConnectFlow(response.cookies);
    return response;
  };

  const config = readGitHubConnectConfig();
  if (!config) return fail("unavailable");

  const error = params.get("error");
  if (error) return fail(error === "access_denied" ? "denied" : "error");

  const nextTrip = (installOffered: boolean) => {
    const state = createOAuthState();
    const pkce = createPkcePair();
    const next: GitHubConnectFlow = {
      ...flow,
      state,
      verifier: pkce.verifier,
      installOffered,
      trips: flow.trips + 1,
    };
    return { next, challenge: pkce.challenge };
  };

  const code = params.get("code");
  if (!statesMatch(params.get("state"), flow.state)) {
    if (
      (returningFromInstall || (code && !params.has("state"))) &&
      flow.trips < MAX_FLOW_ROUND_TRIPS
    ) {
      const { next, challenge } = nextTrip(true);
      const response = redirect(
        buildAuthorizeUrl({
          clientId: config.clientId,
          redirectUri,
          state: next.state,
          codeChallenge: challenge,
        }),
      );
      writeConnectFlow(response.cookies, next);
      return response;
    }
    return fail("state_mismatch");
  }
  if (!code) return fail("error");

  let connection;
  try {
    const tokens = await exchangeCodeForTokens(config, {
      code,
      codeVerifier: flow.verifier,
      redirectUri,
    });
    const user = await fetchGitHubUser(tokens.accessToken);
    if (!user) return fail("exchange_failed");
    connection = toGitHubConnection(user, tokens);
  } catch (caught) {
    log("exchange_failed", {
      code: caught instanceof GitHubTokenError ? caught.code : "unknown",
    });
    return fail("exchange_failed");
  }

  const repository = parseRepository(flow.repo);
  let result = "connected";
  let response: NextResponse | null = null;
  if (repository) {
    const access = await checkRepositoryAccess(
      connection.at,
      repository.owner,
      repository.repo,
    );
    if (access === "missing") {
      if (!flow.installOffered && flow.trips < MAX_FLOW_ROUND_TRIPS) {
        // Signed in, but the app is not on this repository yet: open GitHub's
        // install page on the repository owner's account.
        const targetId = await fetchAccountId(
          repository.owner,
          githubApiHeaders(connection.at),
        );
        const { next } = nextTrip(true);
        response = redirect(
          buildInstallUrl(config.appSlug, targetId ?? undefined),
        );
        writeConnectFlow(response.cookies, next);
        log("install_offered", { trips: flow.trips });
      } else {
        result = "no_access";
      }
    }
  }

  if (!response) {
    response = redirect(returnUrl(origin, flow, result));
    clearConnectFlow(response.cookies);
    log(result === "connected" ? "completed" : "failed", {
      reason: result === "connected" ? undefined : result,
      trips: flow.trips,
    });
  }
  // One GitHub credential at a time: the sign-in replaces a pasted token.
  writeGitHubConnection(response.cookies, connection);
  clearStoredCredential(response.cookies, "github_pat");
  return response;
}
