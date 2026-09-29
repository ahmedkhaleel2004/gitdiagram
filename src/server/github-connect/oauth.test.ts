// @vitest-environment node
import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildAuthorizeUrl,
  buildInstallUrl,
  checkRepositoryAccess,
  createOAuthState,
  createPkcePair,
  exchangeCodeForTokens,
  GitHubTokenError,
} from "./oauth";

const config = {
  clientId: "Iv-test",
  clientSecret: "test-secret",
  appSlug: "gitdiagram-private-repos",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub connect OAuth helpers", () => {
  it("makes an RFC 7636 S256 verifier and challenge", () => {
    const { verifier, challenge } = createPkcePair();

    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(challenge).toBe(
      createHash("sha256").update(verifier).digest("base64url"),
    );
    expect(createPkcePair().verifier).not.toBe(verifier);
    expect(createOAuthState()).not.toBe(createOAuthState());
  });

  it("asks GitHub for a PKCE-protected code with our state", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "Iv-test",
        redirectUri: "https://gitdiagram.com/api/github/callback",
        state: "state-123",
        codeChallenge: "challenge-abc",
      }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "Iv-test",
      redirect_uri: "https://gitdiagram.com/api/github/callback",
      state: "state-123",
      code_challenge: "challenge-abc",
      code_challenge_method: "S256",
    });
  });

  it("targets the install page at the repository owner when known", () => {
    expect(buildInstallUrl("gitdiagram-private-repos")).toBe(
      "https://github.com/apps/gitdiagram-private-repos/installations/new",
    );
    const targeted = new URL(buildInstallUrl("gitdiagram-private-repos", 9));
    expect(targeted.pathname).toBe(
      "/apps/gitdiagram-private-repos/installations/new/permissions",
    );
    expect(targeted.searchParams.get("target_id")).toBe("9");
    expect(targeted.searchParams.get("suggested_target_id")).toBe("9");
  });

  it("exchanges a code with its verifier and reads expiring tokens", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        access_token: "ghu_a",
        expires_in: 28_800,
        refresh_token: "ghr_r",
        refresh_token_expires_in: 15_897_600,
        token_type: "bearer",
        scope: "",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const before = Date.now();

    const tokens = await exchangeCodeForTokens(config, {
      code: "code-1",
      codeVerifier: "verifier-1",
      redirectUri: "https://gitdiagram.com/api/github/callback",
    });

    const init = (
      fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      client_id: "Iv-test",
      client_secret: "test-secret",
      code: "code-1",
      code_verifier: "verifier-1",
      redirect_uri: "https://gitdiagram.com/api/github/callback",
    });
    expect(tokens.accessToken).toBe("ghu_a");
    expect(tokens.refreshToken).toBe("ghr_r");
    expect(tokens.accessTokenExpiresAt).toBeGreaterThanOrEqual(
      before + 28_800_000,
    );
  });

  it("treats GitHub's 200-with-error answers as failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "bad_verification_code" })),
    );

    await expect(
      exchangeCodeForTokens(config, {
        code: "stale",
        codeVerifier: "v",
        redirectUri: "https://gitdiagram.com/api/github/callback",
      }),
    ).rejects.toEqual(new GitHubTokenError("bad_verification_code"));
  });

  it("tells a missing installation apart from an outage", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("{}", { status: 200 }))
        .mockResolvedValueOnce(new Response("{}", { status: 404 }))
        .mockResolvedValueOnce(new Response("{}", { status: 502 })),
    );

    await expect(checkRepositoryAccess("ghu", "o", "r")).resolves.toBe(
      "granted",
    );
    await expect(checkRepositoryAccess("ghu", "o", "r")).resolves.toBe(
      "missing",
    );
    await expect(checkRepositoryAccess("ghu", "o", "r")).resolves.toBe(
      "unknown",
    );
  });
});
