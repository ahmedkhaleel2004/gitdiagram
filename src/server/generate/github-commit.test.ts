import { beforeEach, describe, expect, it, vi } from "vitest";

const { getGitHubApiHeaders } = vi.hoisted(() => ({
  getGitHubApiHeaders: vi.fn(),
}));

vi.mock("~/server/github-auth", () => ({
  getGitHubApiHeaders,
}));

import { classifyGitHubError } from "~/server/generate/github-errors";
import { getGithubData, resolveCommit } from "~/server/generate/github";

const FULL = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "89abcdef0123456789abcdef0123456789abcdef";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Scenario {
  /** The answer to `GET /commits/{ref}`. */
  commit?: (ref: string) => Response;
  isPrivate?: boolean;
  /** Whether the repository itself can be read. */
  repoVisible?: boolean;
}

function createFetch({
  commit = () => new Response(FULL),
  isPrivate = false,
  repoVisible = true,
}: Scenario = {}) {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    const commitMatch = /\/repos\/acme\/demo\/commits\/([^/?]+)$/.exec(url);
    if (commitMatch) return commit(commitMatch[1]!);
    if (url.endsWith("/repos/acme/demo")) {
      return repoVisible
        ? jsonResponse({
            default_branch: "main",
            private: isPrivate,
            stargazers_count: 1,
          })
        : jsonResponse({ message: "Not Found" }, 404);
    }
    if (url.includes(`/git/trees/${FULL}?recursive=1`)) {
      return jsonResponse({
        truncated: false,
        tree: [{ path: "src/main.ts", type: "blob" }],
      });
    }
    if (url.includes("/readme?ref=")) {
      return jsonResponse({
        size: 6,
        content: Buffer.from("# Demo").toString("base64"),
        encoding: "base64",
      });
    }
    throw new Error(`Unexpected GitHub URL: ${url}`);
  });
}

function urlsOf(fetchMock: ReturnType<typeof createFetch>) {
  return fetchMock.mock.calls.map(([url]) => String(url));
}

describe("commit resolution", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    getGitHubApiHeaders.mockReset();
    getGitHubApiHeaders.mockResolvedValue({
      Accept: "application/vnd.github+json",
    });
  });

  it("resolves a short SHA to the full SHA", async () => {
    const fetchMock = createFetch();
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveCommit("acme", "demo", FULL.slice(0, 7))).resolves.toBe(
      FULL,
    );

    expect(urlsOf(fetchMock)).toEqual([
      `https://api.github.com/repos/acme/demo/commits/${FULL.slice(0, 7)}`,
    ]);
  });

  it("asks GitHub for the bare SHA", async () => {
    const fetchMock = createFetch();
    vi.stubGlobal("fetch", fetchMock);

    await resolveCommit("acme", "demo", FULL);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(init?.headers).get("Accept")).toBe(
      "application/vnd.github.sha",
    );
  });

  it("accepts the JSON form of the commit and normalizes case", async () => {
    vi.stubGlobal(
      "fetch",
      createFetch({ commit: () => jsonResponse({ sha: FULL.toUpperCase() }) }),
    );

    await expect(
      resolveCommit("acme", "demo", FULL.slice(0, 12).toUpperCase()),
    ).resolves.toBe(FULL);
  });

  it.each(["", "abc123", "main", "HEAD~1", "g".repeat(40), `${FULL}0`])(
    "rejects the malformed SHA %j before calling GitHub",
    async (commit) => {
      const fetchMock = createFetch();
      vi.stubGlobal("fetch", fetchMock);

      const error = await resolveCommit("acme", "demo", commit).catch(
        (caught: unknown) => caught,
      );

      expect(classifyGitHubError(error, false)).toMatchObject({
        errorCode: "COMMIT_SHA_INVALID",
        status: 400,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([404, 409, 422])(
    "maps a %i answer in a readable repository to COMMIT_NOT_FOUND",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        createFetch({
          commit: () =>
            jsonResponse({ message: "No commit found for SHA" }, status),
        }),
      );

      const error = await resolveCommit("acme", "demo", "deadbeef").catch(
        (caught: unknown) => caught,
      );

      expect(classifyGitHubError(error, false)).toMatchObject({
        errorCode: "COMMIT_NOT_FOUND",
        status: 404,
      });
    },
  );

  it("maps an ambiguous short SHA to COMMIT_AMBIGUOUS", async () => {
    const fetchMock = createFetch({
      commit: () =>
        jsonResponse({ message: "Commit sha is ambiguous: deadbeef" }, 422),
    });
    vi.stubGlobal("fetch", fetchMock);

    const error = await resolveCommit("acme", "demo", "deadbeef").catch(
      (caught: unknown) => caught,
    );

    expect(classifyGitHubError(error, false)).toMatchObject({
      errorCode: "COMMIT_AMBIGUOUS",
      status: 422,
    });
    // No need to read the repository to know that.
    expect(urlsOf(fetchMock)).toHaveLength(1);
  });

  it("does not let a branch name that looks like hexadecimal pass for a commit", async () => {
    // GitHub resolves branches and tags in this endpoint too.
    vi.stubGlobal("fetch", createFetch({ commit: () => new Response(OTHER) }));

    const error = await resolveCommit("acme", "demo", "deadbeef").catch(
      (caught: unknown) => caught,
    );

    expect(classifyGitHubError(error, false)?.errorCode).toBe(
      "COMMIT_NOT_FOUND",
    );
  });

  it("requires a full SHA to come back exactly", async () => {
    vi.stubGlobal("fetch", createFetch({ commit: () => new Response(OTHER) }));

    const error = await resolveCommit("acme", "demo", FULL).catch(
      (caught: unknown) => caught,
    );

    expect(classifyGitHubError(error, false)?.errorCode).toBe(
      "COMMIT_NOT_FOUND",
    );
  });

  it("asks for a token when the repository is private and the caller has none", async () => {
    vi.stubGlobal(
      "fetch",
      createFetch({
        isPrivate: true,
        commit: () => jsonResponse({ message: "Not Found" }, 404),
      }),
    );

    const error = await resolveCommit("acme", "demo", FULL).catch(
      (caught: unknown) => caught,
    );

    expect(classifyGitHubError(error, false)).toMatchObject({
      errorCode: "GITHUB_AUTH_REQUIRED",
      status: 403,
    });
  });

  it("reports an unreadable repository as not found", async () => {
    vi.stubGlobal(
      "fetch",
      createFetch({
        repoVisible: false,
        commit: () => jsonResponse({ message: "Not Found" }, 404),
      }),
    );

    const error = await resolveCommit("acme", "demo", FULL).catch(
      (caught: unknown) => caught,
    );

    expect(classifyGitHubError(error, false)?.errorCode).toBe(
      "REPOSITORY_NOT_FOUND",
    );
  });

  it("does not let a private repository's commit through without the caller's token", async () => {
    // The server's own credentials may see a private commit; they must not
    // become authorization for an anonymous caller.
    vi.stubGlobal("fetch", createFetch({ isPrivate: true }));

    const error = await getGithubData("acme", "demo", undefined, undefined, {
      commit: FULL,
    }).catch((caught: unknown) => caught);

    expect(classifyGitHubError(error, false)?.errorCode).toBe(
      "GITHUB_AUTH_REQUIRED",
    );
  });
});

describe("ingestion at a commit", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    getGitHubApiHeaders.mockReset();
    getGitHubApiHeaders.mockResolvedValue({
      Accept: "application/vnd.github+json",
    });
  });

  it("reads the tree and the README at the resolved SHA, not the default branch", async () => {
    const fetchMock = createFetch();
    vi.stubGlobal("fetch", fetchMock);

    const data = await getGithubData("acme", "demo", undefined, undefined, {
      commit: FULL.slice(0, 9),
    });

    expect(data.commitSha).toBe(FULL);
    expect(data.defaultBranch).toBe("main");
    expect(data.fileTree).toBe("src/main.ts");
    expect(data.readme).toBe("# Demo");
    const urls = urlsOf(fetchMock);
    expect(urls[0]).toBe(
      `https://api.github.com/repos/acme/demo/commits/${FULL.slice(0, 9)}`,
    );
    expect(urls).toContain(
      `https://api.github.com/repos/acme/demo/git/trees/${FULL}?recursive=1`,
    );
    expect(urls).toContain(
      `https://api.github.com/repos/acme/demo/readme?ref=${FULL}`,
    );
    expect(urls.some((url) => url.includes("/git/trees/main"))).toBe(false);
  });

  it("leaves the default-branch read exactly as it was", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/repos/acme/demo"))
        return jsonResponse({ default_branch: "main", private: false });
      if (url.includes("/git/trees/main?recursive=1"))
        return jsonResponse({
          truncated: false,
          tree: [{ path: "src/main.ts", type: "blob" }],
        });
      if (url.endsWith("/repos/acme/demo/readme"))
        return jsonResponse({
          size: 6,
          content: Buffer.from("# Demo").toString("base64"),
          encoding: "base64",
        });
      throw new Error(`Unexpected GitHub URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const data = await getGithubData("acme", "demo");

    expect(data.commitSha).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("surfaces a missing commit before any ingestion", async () => {
    const fetchMock = createFetch({
      commit: () => jsonResponse({ message: "No commit found" }, 422),
    });
    vi.stubGlobal("fetch", fetchMock);

    const error = await getGithubData("acme", "demo", undefined, undefined, {
      commit: "deadbeef",
    }).catch((caught: unknown) => caught);

    expect(classifyGitHubError(error, false)?.errorCode).toBe(
      "COMMIT_NOT_FOUND",
    );
    expect(urlsOf(fetchMock).some((url) => url.includes("/git/trees/"))).toBe(
      false,
    );
  });
});
