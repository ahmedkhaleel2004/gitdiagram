// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET as connect } from "~/app/api/github/connect/route";
import { GET as callback } from "~/app/api/github/callback/route";
import {
  GITHUB_CONNECTION_COOKIE,
  readGitHubConnection,
} from "~/server/github-connect/connection";
import {
  GITHUB_CONNECT_FLOW_COOKIE,
  readConnectFlow,
  writeConnectFlow,
  type GitHubConnectFlow,
} from "~/server/github-connect/flow";
import { pkceChallenge } from "~/server/github-connect/oauth";

const ORIGIN = "https://gitdiagram.com";

type SetCookie = { name: string; value: string; maxAge?: number };

function setCookies(response: Response): Map<string, SetCookie> {
  const cookies = new Map<string, SetCookie>();
  for (const header of response.headers.getSetCookie()) {
    const [pair, ...attributes] = header.split(";").map((part) => part.trim());
    const index = pair!.indexOf("=");
    const name = pair!.slice(0, index);
    const maxAge = attributes
      .find((attribute) => attribute.toLowerCase().startsWith("max-age="))
      ?.split("=")[1];
    cookies.set(name, {
      name,
      value: decodeURIComponent(pair!.slice(index + 1)),
      maxAge: maxAge === undefined ? undefined : Number(maxAge),
    });
  }
  return cookies;
}

function cookieReader(cookies: Map<string, SetCookie>) {
  return { get: (name: string) => cookies.get(name) };
}

function sealedFlow(flow: Partial<GitHubConnectFlow> = {}): string {
  let value = "";
  writeConnectFlow(
    { set: (_name: string, sealed: string) => (value = sealed) },
    {
      v: 1,
      state: "state-0123456789abcdef",
      verifier: "v".repeat(43),
      repo: "octo/private-app",
      returnTo: "/octo/private-app",
      source: "repo",
      installOffered: false,
      trips: 0,
      ...flow,
    },
  );
  return value;
}

function callbackRequest(query: string, flowCookie?: string) {
  return new NextRequest(`${ORIGIN}/api/github/callback?${query}`, {
    headers: flowCookie
      ? { cookie: `${GITHUB_CONNECT_FLOW_COOKIE}=${flowCookie}` }
      : {},
  });
}

function githubApi(options: { repoStatus?: number } = {}) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://github.com/login/oauth/access_token") {
      const body = new URLSearchParams(String(init?.body));
      if (body.get("code") !== "good-code") {
        return Response.json({ error: "bad_verification_code" });
      }
      return Response.json({
        access_token: "ghu_user",
        expires_in: 28_800,
        refresh_token: "ghr_user",
        refresh_token_expires_in: 15_897_600,
        token_type: "bearer",
        scope: "",
      });
    }
    if (url === "https://api.github.com/user") {
      return Response.json({ id: 42, login: "octocat" });
    }
    if (url.startsWith("https://api.github.com/repos/")) {
      return new Response("{}", { status: options.repoStatus ?? 200 });
    }
    if (url.startsWith("https://api.github.com/users/")) {
      return Response.json({ id: 777 });
    }
    return new Response("unexpected", { status: 500 });
  });
}

beforeEach(() => {
  vi.stubEnv("CACHE_KEY_SECRET", "test-cache-key-secret");
  vi.stubEnv("GITHUB_CONNECT_CLIENT_ID", "Iv-test");
  vi.stubEnv("GITHUB_CONNECT_CLIENT_SECRET", "test-secret");
  vi.stubEnv("GITHUB_CONNECT_APP_SLUG", "gitdiagram-private-repos");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/github/connect", () => {
  it("starts a PKCE sign-in and remembers it in a sealed Lax cookie", async () => {
    const response = await connect(
      new NextRequest(`${ORIGIN}/api/github/connect?repo=Octo/Private-App`),
    );

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(location.searchParams.get("client_id")).toBe("Iv-test");
    expect(location.searchParams.get("redirect_uri")).toBe(
      `${ORIGIN}/api/github/callback`,
    );
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");

    const header = response.headers.getSetCookie()[0]!;
    expect(header).toMatch(/HttpOnly/iu);
    expect(header).toMatch(/SameSite=lax/iu);
    expect(header).toMatch(/Path=\/api\/github/iu);
    const flow = readConnectFlow(cookieReader(setCookies(response)))!;
    expect(flow).toMatchObject({
      repo: "octo/private-app",
      returnTo: "/octo/private-app",
      source: "repo",
    });
    expect(location.searchParams.get("state")).toBe(flow.state);
    expect(location.searchParams.get("code_challenge")).toBe(
      pkceChallenge(flow.verifier),
    );
    expect(header).not.toContain(flow.verifier);
  });

  it("returns to the page when sign-in is not configured", async () => {
    vi.stubEnv("GITHUB_CONNECT_CLIENT_SECRET", "");

    const response = await connect(
      new NextRequest(
        `${ORIGIN}/api/github/connect?from=menu&return=${encodeURIComponent("/browse")}`,
      ),
    );

    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/browse?github=unavailable&github_from=menu`,
    );
  });

  it("never returns to another site", async () => {
    vi.stubEnv("GITHUB_CONNECT_CLIENT_SECRET", "");

    const response = await connect(
      new NextRequest(
        `${ORIGIN}/api/github/connect?from=menu&return=${encodeURIComponent("//evil.example/x")}`,
      ),
    );

    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/?github=unavailable&github_from=menu`,
    );
  });

  it("can open the targeted install page first", async () => {
    vi.stubGlobal("fetch", githubApi());

    const response = await connect(
      new NextRequest(
        `${ORIGIN}/api/github/connect?repo=octo/private-app&install=1`,
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://github.com/apps/gitdiagram-private-repos/installations/new/permissions?suggested_target_id=777&target_id=777",
    );
    expect(
      readConnectFlow(cookieReader(setCookies(response)))?.installOffered,
    ).toBe(true);
  });
});

describe("GET /api/github/callback", () => {
  it("exchanges the code, seals the sign-in, and returns to the repository", async () => {
    const fetchMock = githubApi();
    vi.stubGlobal("fetch", fetchMock);

    const response = await callback(
      callbackRequest(
        "code=good-code&state=state-0123456789abcdef",
        sealedFlow(),
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/octo/private-app?github=connected`,
    );
    const exchange = fetchMock.mock.calls.find(
      ([url]) => String(url) === "https://github.com/login/oauth/access_token",
    )!;
    expect(
      new URLSearchParams(String(exchange[1]?.body)).get("code_verifier"),
    ).toBe("v".repeat(43));

    const cookies = setCookies(response);
    const connection = readGitHubConnection(cookieReader(cookies));
    expect(connection).toMatchObject({
      uid: 42,
      login: "octocat",
      at: "ghu_user",
      rt: "ghr_user",
    });
    expect(cookies.get(GITHUB_CONNECTION_COOKIE)!.value).not.toContain("ghu_");
    expect(cookies.get(GITHUB_CONNECT_FLOW_COOKIE)?.maxAge).toBe(0);
    expect(cookies.get("gitdiagram_github_pat")?.maxAge).toBe(0);
    const header = response.headers
      .getSetCookie()
      .find((value) => value.startsWith(`${GITHUB_CONNECTION_COOKIE}=`))!;
    expect(header).toMatch(/SameSite=strict/iu);
    expect(header).toMatch(/Path=\/api(;|$)/iu);
  });

  it("refuses a code whose state does not match", async () => {
    const fetchMock = githubApi();
    vi.stubGlobal("fetch", fetchMock);

    const response = await callback(
      callbackRequest("code=good-code&state=someone-elses-state", sealedFlow()),
    );

    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/octo/private-app?github=state_mismatch`,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setCookies(response).has(GITHUB_CONNECTION_COOKIE)).toBe(false);
  });

  it("refuses a callback with no sign-in in progress", async () => {
    const fetchMock = githubApi();
    vi.stubGlobal("fetch", fetchMock);

    const response = await callback(
      callbackRequest("code=good-code&state=state-0123456789abcdef"),
    );

    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/?github=expired&github_from=menu`,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a cancelled sign-in", async () => {
    const response = await callback(
      callbackRequest(
        "error=access_denied&state=state-0123456789abcdef",
        sealedFlow(),
      ),
    );

    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/octo/private-app?github=denied`,
    );
  });

  it("reports a code GitHub will not exchange", async () => {
    vi.stubGlobal("fetch", githubApi());

    const response = await callback(
      callbackRequest("code=stale&state=state-0123456789abcdef", sealedFlow()),
    );

    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/octo/private-app?github=exchange_failed`,
    );
  });

  it("sends a signed-in visitor to install on the repository's owner", async () => {
    vi.stubGlobal("fetch", githubApi({ repoStatus: 404 }));

    const response = await callback(
      callbackRequest(
        "code=good-code&state=state-0123456789abcdef",
        sealedFlow(),
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://github.com/apps/gitdiagram-private-repos/installations/new/permissions?suggested_target_id=777&target_id=777",
    );
    const cookies = setCookies(response);
    expect(readGitHubConnection(cookieReader(cookies))?.uid).toBe(42);
    expect(readConnectFlow(cookieReader(cookies))).toMatchObject({
      installOffered: true,
      trips: 1,
    });
  });

  it("re-authorizes silently after GitHub's install page", async () => {
    const fetchMock = githubApi();
    vi.stubGlobal("fetch", fetchMock);

    const response = await callback(
      callbackRequest(
        "code=install-time-code&installation_id=5&setup_action=install",
        sealedFlow({ installOffered: true, trips: 1 }),
      ),
    );

    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    // The install-time code came without our state and is never exchanged.
    expect(fetchMock).not.toHaveBeenCalled();
    const flow = readConnectFlow(cookieReader(setCookies(response)))!;
    expect(location.searchParams.get("state")).toBe(flow.state);
    expect(flow.state).not.toBe("state-0123456789abcdef");
    expect(flow.trips).toBe(2);
  });

  it("stops after the install page if the repository is still hidden", async () => {
    vi.stubGlobal("fetch", githubApi({ repoStatus: 404 }));

    const response = await callback(
      callbackRequest(
        "code=good-code&state=state-0123456789abcdef",
        sealedFlow({ installOffered: true, trips: 2 }),
      ),
    );

    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/octo/private-app?github=no_access`,
    );
    expect(
      readGitHubConnection(cookieReader(setCookies(response)))?.login,
    ).toBe("octocat");
  });

  it("bounds the silent round trips", async () => {
    const response = await callback(
      callbackRequest(
        "installation_id=5&setup_action=update",
        sealedFlow({ installOffered: true, trips: 4 }),
      ),
    );

    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/octo/private-app?github=state_mismatch`,
    );
  });
});
