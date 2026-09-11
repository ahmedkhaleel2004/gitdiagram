// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as RequestCredentialsModule from "~/server/http/request-credentials";

const mocks = vi.hoisted(() => ({
  clearCredential: vi.fn(),
  getCredentialStatus: vi.fn(),
  setCredential: vi.fn(),
}));

vi.mock("~/server/http/request-credentials", async (importOriginal) => {
  const original = await importOriginal<typeof RequestCredentialsModule>();
  return {
    ...original,
    clearCredential: mocks.clearCredential,
    getCredentialStatus: mocks.getCredentialStatus,
    setCredential: mocks.setCredential,
  };
});

import { POST } from "~/app/api/credentials/route";

function request(body: unknown, origin = "https://gitdiagram.com"): Request {
  return new Request("https://gitdiagram.com/api/credentials", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Origin: origin,
      "Sec-Fetch-Site":
        origin === "https://gitdiagram.com" ? "same-origin" : "cross-site",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const status = {
      openaiApiKeyConfigured: false,
      githubPatConfigured: false,
    };
    mocks.getCredentialStatus.mockResolvedValue(status);
    mocks.setCredential.mockResolvedValue(status);
    mocks.clearCredential.mockResolvedValue(status);
  });

  it("returns status without exposing credential values", async () => {
    mocks.getCredentialStatus.mockResolvedValue({
      openaiApiKeyConfigured: true,
      githubPatConfigured: false,
    });

    const response = await POST(request({ action: "status" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      credentials: {
        openaiApiKeyConfigured: true,
        githubPatConfigured: false,
      },
    });
  });

  it("sets and clears credentials without returning their values", async () => {
    const setResponse = await POST(
      request({
        action: "set",
        credential: "openai_api_key",
        value: "sk-secret",
      }),
    );
    const clearResponse = await POST(
      request({
        action: "clear",
        credential: "github_pat",
      }),
    );

    expect(setResponse.status).toBe(200);
    expect(clearResponse.status).toBe(200);
    expect(mocks.setCredential).toHaveBeenCalledWith(
      "openai_api_key",
      "sk-secret",
    );
    expect(mocks.clearCredential).toHaveBeenCalledWith("github_pat");
    expect(JSON.stringify(await setResponse.json())).not.toContain("sk-secret");
  });

  it("rejects cross-origin, malformed, and oversized credential actions", async () => {
    await expect(
      POST(request({ action: "status" }, "https://attacker.example")),
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      POST(request({ action: "set", credential: "github_pat", value: "" })),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      POST(
        request({
          action: "set",
          credential: "github_pat",
          value: "x".repeat(2_049),
        }),
      ),
    ).resolves.toMatchObject({ status: 400 });
    expect(mocks.setCredential).not.toHaveBeenCalled();
  });
});
