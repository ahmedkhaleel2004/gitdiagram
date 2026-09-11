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
});
