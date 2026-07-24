import { beforeEach, describe, expect, it, vi } from "vitest";

const { getGitHubApiHeaders } = vi.hoisted(() => ({
  getGitHubApiHeaders: vi.fn(),
}));

vi.mock("~/server/github-auth", () => ({
  getGitHubApiHeaders,
}));

import {
  GITHUB_REQUEST_TIMEOUT_MS,
  getGithubData,
  MAX_INCLUDED_FILE_TREE_CHARACTERS,
  MAX_README_BYTES,
  REPOSITORY_TOO_LARGE_ERROR,
} from "~/server/generate/github";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createGitHubFetch(
  tree: unknown,
  readme: unknown = {
    size: 6,
    content: Buffer.from("# Demo").toString("base64"),
    encoding: "base64",
  },
) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/repos/acme/demo")) {
      return jsonResponse({
        default_branch: "main",
        private: false,
        stargazers_count: 42,
      });
    }
    if (url.includes("/git/trees/main?recursive=1")) {
      return jsonResponse(tree);
    }
    if (url.endsWith("/repos/acme/demo/readme")) {
      return jsonResponse(readme);
    }
    throw new Error(`Unexpected GitHub URL: ${url}`);
  });
}

describe("getGithubData repository input bounds", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getGitHubApiHeaders.mockReset();
    getGitHubApiHeaders.mockResolvedValue({
      Accept: "application/vnd.github+json",
    });
  });

  it("rejects a truncated recursive tree while fetching inputs concurrently", async () => {
    const fetchMock = createGitHubFetch({
      truncated: true,
      tree: [{ path: "src/main.ts" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGithubData("acme", "demo")).rejects.toThrow(
      REPOSITORY_TOO_LARGE_ERROR,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/readme"),
      expect.anything(),
    );
  });

  it("rejects an oversized filtered file tree", async () => {
    const fetchMock = createGitHubFetch({
      truncated: false,
      tree: [{ path: "a".repeat(MAX_INCLUDED_FILE_TREE_CHARACTERS + 1) }],
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGithubData("acme", "demo")).rejects.toThrow(
      REPOSITORY_TOO_LARGE_ERROR,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects an oversized README from GitHub's size metadata", async () => {
    const fetchMock = createGitHubFetch(
      { truncated: false, tree: [{ path: "src/main.ts" }] },
      {
        size: MAX_README_BYTES + 1,
        content: Buffer.from("# Demo").toString("base64"),
        encoding: "base64",
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGithubData("acme", "demo")).rejects.toThrow(
      REPOSITORY_TOO_LARGE_ERROR,
    );
  });

  it("rejects oversized README bytes when size metadata is missing or false", async () => {
    const oversizedReadme = "é".repeat(Math.floor(MAX_README_BYTES / 2) + 1);
    const fetchMock = createGitHubFetch(
      { truncated: false, tree: [{ path: "src/main.ts" }] },
      {
        size: "unknown",
        content: Buffer.from(oversizedReadme).toString("base64"),
        encoding: "base64",
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGithubData("acme", "demo")).rejects.toThrow(
      REPOSITORY_TOO_LARGE_ERROR,
    );
  });

  it("bounds malformed encoded content before decoding it", async () => {
    const fetchMock = createGitHubFetch(
      { truncated: false, tree: [{ path: "src/main.ts" }] },
      {
        content: "A".repeat(MAX_README_BYTES * 2 + 1),
        encoding: "base64",
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGithubData("acme", "demo")).rejects.toThrow(
      REPOSITORY_TOO_LARGE_ERROR,
    );
  });

  it("ignores malformed and excluded tree entries while preserving valid data", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = createGitHubFetch({
      truncated: false,
      tree: [
        { path: 42 },
        {},
        { path: "node_modules/pkg/index.js" },
        { path: "logs/debug.log" },
        { path: "src/user.login.ts", type: "blob" },
        { path: "src/main.ts", type: "blob" },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGithubData("acme", "demo")).resolves.toEqual({
      defaultBranch: "main",
      fileTree: "src/user.login.ts\nsrc/main.ts",
      readme: "# Demo",
      isPrivate: false,
      stargazerCount: 42,
      pathTypes: new Map([
        ["src/user.login.ts", "blob"],
        ["src/main.ts", "blob"],
      ]),
    });
    expect(timeoutSpy).toHaveBeenCalledTimes(3);
    expect(timeoutSpy).toHaveBeenCalledWith(GITHUB_REQUEST_TIMEOUT_MS);
  });

  it("still ingests a repository that has no README", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/repos/acme/demo")) {
        return jsonResponse({
          default_branch: "main",
          private: false,
          stargazers_count: 42,
        });
      }
      if (url.includes("/git/trees/main?recursive=1")) {
        return jsonResponse({
          truncated: false,
          tree: [{ path: "src/main.ts", type: "blob" }],
        });
      }
      if (url.endsWith("/repos/acme/demo/readme")) {
        return jsonResponse({ message: "Not Found" }, 404);
      }
      throw new Error(`Unexpected GitHub URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGithubData("acme", "demo")).resolves.toMatchObject({
      fileTree: "src/main.ts",
      readme: "",
    });
  });

  it("still fails when the README exists but is oversized", async () => {
    const fetchMock = createGitHubFetch(
      { truncated: false, tree: [{ path: "src/main.ts", type: "blob" }] },
      { size: MAX_README_BYTES + 1, content: "abc", encoding: "base64" },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGithubData("acme", "demo")).rejects.toThrow(
      REPOSITORY_TOO_LARGE_ERROR,
    );
  });

  it("keeps source files whose names merely contain an excluded extension", async () => {
    const fetchMock = createGitHubFetch({
      truncated: false,
      tree: [
        // Each of these was dropped when extensions were matched as substrings.
        { path: "src/ui.icons.ts", type: "blob" },
        { path: "src/data.source.ts", type: "blob" },
        { path: "app/model.classifier.py", type: "blob" },
        { path: "src/parse.sortable.ts", type: "blob" },
        { path: "internal/api.pngenerator.go", type: "blob" },
        // Real matches must still be excluded.
        { path: "assets/logo.png" },
        { path: "build/app.min.js" },
        { path: "src/native.so" },
        { path: "yarn.lock" },
        { path: "pkg/node_modules/dep/index.js" },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGithubData("acme", "demo")).resolves.toMatchObject({
      fileTree: [
        "src/ui.icons.ts",
        "src/data.source.ts",
        "app/model.classifier.py",
        "src/parse.sortable.ts",
        "internal/api.pngenerator.go",
      ].join("\n"),
    });
  });

  it("revalidates cached public trees with ETag and reuses a 304 body", async () => {
    let treeRequests = 0;
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/repos/acme/demo")) {
          return jsonResponse({
            default_branch: "main",
            private: false,
            stargazers_count: 42,
          });
        }
        if (url.includes("/git/trees/main?recursive=1")) {
          treeRequests += 1;
          const headers = new Headers(init?.headers);
          if (treeRequests === 2) {
            expect(headers.get("if-none-match")).toBe('"tree-v1"');
            return new Response(null, { status: 304 });
          }
          return new Response(
            JSON.stringify({
              truncated: false,
              tree: [{ path: "src/cached.ts", type: "blob" }],
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                ETag: '"tree-v1"',
              },
            },
          );
        }
        if (url.endsWith("/repos/acme/demo/readme")) {
          return jsonResponse({
            size: 6,
            content: Buffer.from("# Demo").toString("base64"),
            encoding: "base64",
          });
        }
        throw new Error(`Unexpected GitHub URL: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGithubData("acme", "demo")).resolves.toMatchObject({
      fileTree: "src/cached.ts",
      pathTypes: new Map([["src/cached.ts", "blob"]]),
    });
    await expect(getGithubData("acme", "demo")).resolves.toMatchObject({
      fileTree: "src/cached.ts",
      pathTypes: new Map([["src/cached.ts", "blob"]]),
    });
    expect(treeRequests).toBe(2);
  });

  it("never stores or conditionally reuses private repository trees", async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/repos/acme/demo")) {
          return jsonResponse({ default_branch: "main", private: true });
        }
        if (url.includes("/git/trees/main?recursive=1")) {
          expect(new Headers(init?.headers).has("if-none-match")).toBe(false);
          return new Response(
            JSON.stringify({
              truncated: false,
              tree: [{ path: "src/private.ts" }],
            }),
            { status: 200, headers: { ETag: '"private-tree"' } },
          );
        }
        if (url.endsWith("/repos/acme/demo/readme")) {
          return jsonResponse({
            size: 9,
            content: Buffer.from("# Private").toString("base64"),
            encoding: "base64",
          });
        }
        throw new Error(`Unexpected GitHub URL: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await getGithubData("acme", "demo");
    await getGithubData("acme", "demo");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
