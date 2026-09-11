import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearCredential,
  getCredentialStatus,
  migrateLegacyCredentialStorage,
  resetLegacyCredentialMigrationForTests,
  saveCredential,
  type CredentialKind,
} from "~/features/credentials/api";

afterEach(() => {
  resetLegacyCredentialMigrationForTests();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("credential client API", () => {
  it("sends only credential actions to the same-origin endpoint", async () => {
    const credentials = {
      openaiApiKeyConfigured: true,
      githubPatConfigured: false,
    };
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true, credentials }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCredentialStatus()).resolves.toEqual(credentials);
    await saveCredential("openai_api_key", "sk-secret");
    await clearCredential("github_pat");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "status" }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        action: "set",
        credential: "openai_api_key",
        value: "sk-secret",
      }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        action: "clear",
        credential: "github_pat",
      }),
    });
  });

  it("rejects an unavailable credential endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );

    await expect(getCredentialStatus()).rejects.toThrow(
      "Credential settings are temporarily unavailable.",
    );
  });

  it("migrates legacy credentials and removes each saved value", async () => {
    window.localStorage.setItem("openai_api_key", "legacy-openai");
    window.localStorage.setItem("github_pat", "legacy-github");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          ok: true,
          credentials: {
            openaiApiKeyConfigured: true,
            githubPatConfigured: true,
          },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(migrateLegacyCredentialStorage()).resolves.toBe(true);

    expect(window.localStorage.getItem("openai_api_key")).toBeNull();
    expect(window.localStorage.getItem("github_pat")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body))),
    ).toEqual([
      {
        action: "set",
        credential: "openai_api_key",
        value: "legacy-openai",
      },
      {
        action: "set",
        credential: "github_pat",
        value: "legacy-github",
      },
    ]);
  });

  it("retains only the legacy credential whose save fails", async () => {
    window.localStorage.setItem("openai_api_key", "legacy-openai");
    window.localStorage.setItem("github_pat", "legacy-github");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const action = JSON.parse(String(init?.body)) as {
          credential: CredentialKind;
        };
        return action.credential === "github_pat"
          ? new Response(null, { status: 503 })
          : Response.json({
              ok: true,
              credentials: {
                openaiApiKeyConfigured: true,
                githubPatConfigured: false,
              },
            });
      }),
    );

    await expect(migrateLegacyCredentialStorage()).resolves.toBe(false);

    expect(window.localStorage.getItem("openai_api_key")).toBeNull();
    expect(window.localStorage.getItem("github_pat")).toBe("legacy-github");
  });

  it("keeps a legacy value until its server save completes", async () => {
    window.localStorage.setItem("openai_api_key", "legacy-openai");
    let acceptSave!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            acceptSave = resolve;
          }),
      ),
    );

    const migration = migrateLegacyCredentialStorage();

    expect(window.localStorage.getItem("openai_api_key")).toBe("legacy-openai");
    acceptSave(
      Response.json({
        ok: true,
        credentials: {
          openaiApiKeyConfigured: true,
          githubPatConfigured: false,
        },
      }),
    );
    await expect(migration).resolves.toBe(true);
    expect(window.localStorage.getItem("openai_api_key")).toBeNull();
  });

  it("finishes a pending migration write before saving a replacement", async () => {
    window.localStorage.setItem("openai_api_key", "legacy-openai");
    let acceptMigration!: (response: Response) => void;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const action = JSON.parse(String(init?.body)) as CredentialAction;
      if (action.action === "set" && action.value === "legacy-openai") {
        return new Promise<Response>((resolve) => {
          acceptMigration = resolve;
        });
      }
      return Promise.resolve(configuredCredentialResponse());
    });
    vi.stubGlobal("fetch", fetchMock);

    const replacement = saveCredential("openai_api_key", "replacement-openai");

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(parseCredentialAction(fetchMock.mock.calls[0]?.[1])).toEqual({
      action: "set",
      credential: "openai_api_key",
      value: "legacy-openai",
    });

    acceptMigration(configuredCredentialResponse());
    await expect(replacement).resolves.toEqual({
      openaiApiKeyConfigured: true,
      githubPatConfigured: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(parseCredentialAction(fetchMock.mock.calls[1]?.[1])).toEqual({
      action: "set",
      credential: "openai_api_key",
      value: "replacement-openai",
    });
    expect(window.localStorage.getItem("openai_api_key")).toBeNull();
  });

  it("finishes a pending migration write before clearing a credential", async () => {
    window.localStorage.setItem("github_pat", "legacy-github");
    let acceptMigration!: (response: Response) => void;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const action = JSON.parse(String(init?.body)) as CredentialAction;
      if (action.action === "set") {
        return new Promise<Response>((resolve) => {
          acceptMigration = resolve;
        });
      }
      return Promise.resolve(configuredCredentialResponse());
    });
    vi.stubGlobal("fetch", fetchMock);

    const clearing = clearCredential("github_pat");

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(parseCredentialAction(fetchMock.mock.calls[0]?.[1])).toEqual({
      action: "set",
      credential: "github_pat",
      value: "legacy-github",
    });

    acceptMigration(configuredCredentialResponse());
    await expect(clearing).resolves.toEqual({
      openaiApiKeyConfigured: true,
      githubPatConfigured: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(parseCredentialAction(fetchMock.mock.calls[1]?.[1])).toEqual({
      action: "clear",
      credential: "github_pat",
    });
    expect(window.localStorage.getItem("github_pat")).toBeNull();
  });

  it("removes a stale legacy value after an explicit save following migration failure", async () => {
    window.localStorage.setItem("openai_api_key", "legacy-openai");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(configuredCredentialResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveCredential("openai_api_key", "replacement-openai"),
    ).resolves.toEqual({
      openaiApiKeyConfigured: true,
      githubPatConfigured: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(parseCredentialAction(fetchMock.mock.calls[1]?.[1])).toEqual({
      action: "set",
      credential: "openai_api_key",
      value: "replacement-openai",
    });
    expect(window.localStorage.getItem("openai_api_key")).toBeNull();
  });

  it("removes a stale legacy value after an explicit clear following migration failure", async () => {
    window.localStorage.setItem("github_pat", "legacy-github");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          credentials: {
            openaiApiKeyConfigured: false,
            githubPatConfigured: false,
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(clearCredential("github_pat")).resolves.toEqual({
      openaiApiKeyConfigured: false,
      githubPatConfigured: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(parseCredentialAction(fetchMock.mock.calls[1]?.[1])).toEqual({
      action: "clear",
      credential: "github_pat",
    });
    expect(window.localStorage.getItem("github_pat")).toBeNull();
  });

  it("completes without a request when no legacy credentials exist", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(migrateLegacyCredentialStorage()).resolves.toBe(true);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

type CredentialAction =
  | { action: "status" }
  | { action: "set"; credential: CredentialKind; value: string }
  | { action: "clear"; credential: CredentialKind };

function configuredCredentialResponse(): Response {
  return Response.json({
    ok: true,
    credentials: {
      openaiApiKeyConfigured: true,
      githubPatConfigured: true,
    },
  });
}

function parseCredentialAction(init?: RequestInit): CredentialAction {
  return JSON.parse(String(init?.body)) as CredentialAction;
}
