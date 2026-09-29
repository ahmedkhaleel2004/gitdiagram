// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StoredCookie = {
  value: string;
  options?: {
    httpOnly?: boolean;
    sameSite?: string;
    secure?: boolean;
    path?: string;
    maxAge?: number;
  };
};

const mocks = vi.hoisted(() => {
  const values = new Map<string, StoredCookie>();
  return {
    values,
    cookieStore: {
      get: vi.fn((name: string) => {
        const stored = values.get(name);
        return stored ? { name, value: stored.value } : undefined;
      }),
      set: vi.fn(
        (name: string, value: string, options?: StoredCookie["options"]) => {
          if (options?.maxAge === 0) {
            values.delete(name);
          } else {
            values.set(name, { value, options });
          }
        },
      ),
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => mocks.cookieStore),
}));

import {
  clearCredential,
  CREDENTIAL_COOKIE_MAX_AGE_SECONDS,
  getCredentialStatus,
  resolveRequestCredentials,
  setCredential,
} from "~/server/http/request-credentials";
import {
  GITHUB_CONNECTION_COOKIE,
  readGitHubConnection,
  resetGitHubConnectionRefreshesForTests,
  writeGitHubConnection,
  type GitHubConnection,
} from "~/server/github-connect/connection";

function request(
  origin = "https://gitdiagram.com",
  url = "https://gitdiagram.com/api/generate/stream",
): Request {
  return new Request(url, {
    headers: {
      Origin: origin,
      "Sec-Fetch-Site":
        origin === new URL(url).origin ? "same-origin" : "same-site",
    },
  });
}

describe("request credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.values.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets a bounded HttpOnly cookie with the narrow API scope", async () => {
    await setCredential("openai_api_key", " sk-test ");

    expect(mocks.cookieStore.set).toHaveBeenCalledWith(
      "gitdiagram_openai_api_key",
      "sk-test",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "strict",
        path: "/api",
        maxAge: CREDENTIAL_COOKIE_MAX_AGE_SECONDS,
      }),
    );
    await expect(getCredentialStatus()).resolves.toEqual({
      openaiApiKeyConfigured: true,
      githubPatConfigured: false,
      githubAppConnected: false,
      githubLogin: null,
    });
  });

  it("clears the exact path-scoped cookie by expiring it", async () => {
    await setCredential("github_pat", "github_pat_example");
    await clearCredential("github_pat");

    expect(mocks.cookieStore.set).toHaveBeenLastCalledWith(
      "gitdiagram_github_pat",
      "",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "strict",
        path: "/api",
        maxAge: 0,
      }),
    );
    await expect(getCredentialStatus()).resolves.toEqual({
      openaiApiKeyConfigured: false,
      githubPatConfigured: false,
      githubAppConnected: false,
      githubLogin: null,
    });
  });

  it("marks stored credentials Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await setCredential("openai_api_key", "sk-test");

    expect(mocks.cookieStore.set).toHaveBeenCalledWith(
      "gitdiagram_openai_api_key",
      "sk-test",
      expect.objectContaining({ secure: true }),
    );
  });

  it("prefers explicit compatibility credentials over stored cookies", async () => {
    await setCredential("openai_api_key", "cookie-openai");
    await setCredential("github_pat", "cookie-github");

    await expect(
      resolveRequestCredentials(request(), {
        apiKey: "explicit-openai",
        githubPat: "explicit-github",
      }),
    ).resolves.toEqual({
      apiKey: "explicit-openai",
      githubPat: "explicit-github",
      githubStorageKey: "explicit-github",
    });
  });

  it("does not expose cookie credentials to a same-site subdomain", async () => {
    await setCredential("openai_api_key", "cookie-openai");
    await setCredential("github_pat", "cookie-github");

    await expect(
      resolveRequestCredentials(request("https://evil.gitdiagram.com"), {
        apiKey: "explicit-openai",
      }),
    ).resolves.toEqual({
      apiKey: "explicit-openai",
      githubPat: undefined,
    });
  });

  it("uses stored credentials for a verified same-origin request", async () => {
    await setCredential("openai_api_key", "cookie-openai");
    await setCredential("github_pat", "cookie-github");

    await expect(resolveRequestCredentials(request())).resolves.toEqual({
      apiKey: "cookie-openai",
      githubPat: "cookie-github",
      githubStorageKey: "cookie-github",
    });
  });

  it("ignores malformed oversized cookie values", async () => {
    mocks.values.set("gitdiagram_openai_api_key", {
      value: "x".repeat(2_049),
    });

    await expect(resolveRequestCredentials(request())).resolves.toEqual({
      apiKey: undefined,
      githubPat: undefined,
    });
  });

  describe("with a GitHub sign-in", () => {
    const connection = (
      overrides: Partial<GitHubConnection> = {},
    ): GitHubConnection => ({
      v: 1,
      uid: 42,
      login: "octocat",
      at: "ghu_current",
      atx: Date.now() + 8 * 60 * 60_000,
      rt: "ghr_current",
      rtx: Date.now() + 180 * 24 * 60 * 60_000,
      ...overrides,
    });

    beforeEach(() => {
      vi.stubEnv("CACHE_KEY_SECRET", "test-cache-key-secret");
      vi.stubEnv("GITHUB_CONNECT_CLIENT_ID", "Iv-test");
      vi.stubEnv("GITHUB_CONNECT_CLIENT_SECRET", "test-secret");
      vi.stubEnv("GITHUB_CONNECT_APP_SLUG", "gitdiagram-private-repos");
      resetGitHubConnectionRefreshesForTests();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("uses the sign-in's token and stores diagrams under its account", async () => {
      writeGitHubConnection(mocks.cookieStore, connection());

      await expect(resolveRequestCredentials(request())).resolves.toEqual({
        apiKey: undefined,
        githubPat: "ghu_current",
        githubStorageKey: "github-user:42",
      });
      await expect(getCredentialStatus()).resolves.toMatchObject({
        githubPatConfigured: false,
        githubAppConnected: true,
        githubLogin: "octocat",
      });
    });

    it("keeps the cookie sealed and ignores a tampered one", async () => {
      writeGitHubConnection(mocks.cookieStore, connection());
      const sealed = mocks.values.get(GITHUB_CONNECTION_COOKIE)!;
      expect(sealed.value).not.toContain("ghu_current");
      expect(sealed.options).toMatchObject({
        httpOnly: true,
        sameSite: "strict",
        path: "/api",
      });

      const bytes = Buffer.from(sealed.value, "base64url");
      bytes[bytes.length - 1]! ^= 1;
      mocks.values.set(GITHUB_CONNECTION_COOKIE, {
        value: bytes.toString("base64url"),
      });
      await expect(resolveRequestCredentials(request())).resolves.toEqual({
        apiKey: undefined,
        githubPat: undefined,
      });
    });

    it("refreshes an expiring token once and re-seals the cookie", async () => {
      writeGitHubConnection(
        mocks.cookieStore,
        connection({ atx: Date.now() + 60_000 }),
      );
      const fetchMock = vi.fn(async () =>
        Response.json({
          access_token: "ghu_next",
          expires_in: 28_800,
          refresh_token: "ghr_next",
          refresh_token_expires_in: 15_897_600,
          token_type: "bearer",
          scope: "",
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const [first, second] = await Promise.all([
        resolveRequestCredentials(request()),
        resolveRequestCredentials(request()),
      ]);

      expect(first.githubPat).toBe("ghu_next");
      expect(second.githubPat).toBe("ghu_next");
      expect(first.githubStorageKey).toBe("github-user:42");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe("https://github.com/login/oauth/access_token");
      expect(
        Object.fromEntries(new URLSearchParams(String(init.body))),
      ).toEqual({
        client_id: "Iv-test",
        client_secret: "test-secret",
        grant_type: "refresh_token",
        refresh_token: "ghr_current",
      });
      expect(readGitHubConnection(mocks.cookieStore)).toMatchObject({
        uid: 42,
        at: "ghu_next",
        rt: "ghr_next",
      });
    });

    it("keeps a still-valid token when a refresh fails", async () => {
      writeGitHubConnection(
        mocks.cookieStore,
        connection({ atx: Date.now() + 60_000 }),
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ error: "bad_refresh_token" })),
      );
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const resolved = await resolveRequestCredentials(request());

      expect(resolved.githubPat).toBe("ghu_current");
      expect(readGitHubConnection(mocks.cookieStore)?.at).toBe("ghu_current");
    });

    it("drops a sign-in whose tokens have both expired", async () => {
      // Written a moment ago, while the refresh token still had seconds left.
      writeGitHubConnection(
        mocks.cookieStore,
        connection({ atx: Date.now() - 1_000, rtx: Date.now() - 1_000 }),
        Date.now() - 10_000,
      );
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const resolved = await resolveRequestCredentials(request());

      expect(resolved.githubPat).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mocks.values.has(GITHUB_CONNECTION_COOKIE)).toBe(false);
    });

    it("lets a pasted token win and replace the sign-in", async () => {
      writeGitHubConnection(mocks.cookieStore, connection());

      await setCredential("github_pat", "github_pat_example");

      expect(mocks.values.has(GITHUB_CONNECTION_COOKIE)).toBe(false);
      await expect(resolveRequestCredentials(request())).resolves.toEqual({
        apiKey: undefined,
        githubPat: "github_pat_example",
        githubStorageKey: "github_pat_example",
      });
    });

    it("clears only the sign-in for github_app", async () => {
      writeGitHubConnection(mocks.cookieStore, connection());
      await setCredential("openai_api_key", "sk-test");
      writeGitHubConnection(mocks.cookieStore, connection());

      await expect(clearCredential("github_app")).resolves.toEqual({
        openaiApiKeyConfigured: true,
        githubPatConfigured: false,
        githubAppConnected: false,
        githubLogin: null,
      });
    });

    it("never reads a sign-in for a cross-origin request", async () => {
      writeGitHubConnection(mocks.cookieStore, connection());

      await expect(
        resolveRequestCredentials(request("https://evil.example")),
      ).resolves.toEqual({
        githubStorageKey: undefined,
      });
    });
  });
});
