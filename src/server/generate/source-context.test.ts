import { afterEach, describe, expect, it, vi } from "vitest";
import type { GithubData } from "./github";
import { fetchSourceContext } from "./source-context";
import { MAX_SOURCE_CHARACTERS } from "./repository-context";
vi.mock("../github-auth", () => ({
  getGitHubApiHeaders: async ({ githubPat }: { githubPat?: string }) => ({
    Authorization: `Bearer ${githubPat ?? "public-server-token"}`,
  }),
}));
afterEach(() => vi.unstubAllGlobals());
function repo(paths = ["src/main.ts"]): GithubData {
  return {
    defaultBranch: "main",
    fileTree: paths.join("\n"),
    readme: "",
    isPrivate: false,
    stargazerCount: 0,
    pathTypes: new Map(paths.map((p) => [p, "blob"])),
    sourceBlobs: new Map(
      paths.map((p, i) => [
        p,
        { sha: i.toString(16).padStart(40, "a"), size: 100 },
      ]),
    ),
  };
}
const body = (text: string) =>
  new Response(
    JSON.stringify({
      encoding: "base64",
      content: Buffer.from(text).toString("base64"),
      size: Buffer.byteLength(text),
    }),
  );

describe("bounded source ingestion", () => {
  it("fetches only verified blobs and never follows symlinks, arbitrary paths or redirects", async () => {
    const fetchMock = vi.fn(async (_input: string, _init: RequestInit) =>
      body("export const main = 1;"),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchSourceContext({
      username: "owner",
      repo: "repo",
      githubData: repo(),
      selectedPaths: ["src/main.ts", "src/symlink.ts", ".env"],
    });
    expect(result.paths).toEqual(["src/main.ts"]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.github.com/repos/owner/repo/git/blobs/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      cache: "no-store",
    });
  });
  it("rejects private reads without caller authorization before any fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchSourceContext({
        username: "owner",
        repo: "repo",
        githubData: { ...repo(), isPrivate: true },
        selectedPaths: ["src/main.ts"],
      }),
    ).rejects.toThrow("GitHub token");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("degrades unavailable or binary source to an explicit coverage limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 403 }))
        .mockResolvedValueOnce(body("\0binary")),
    );
    const result = await fetchSourceContext({
      username: "owner",
      repo: "repo",
      githubData: repo(["a.ts", "b.ts"]),
      selectedPaths: ["a.ts", "b.ts"],
    });
    expect(result.paths).toEqual([]);
    expect(result.unavailableCount).toBe(2);
    expect(result.text).toContain("No source excerpts");
  });
  it("bounds total excerpts and rejects an oversized streamed response", async () => {
    const paths = Array.from({ length: 12 }, (_, i) => `src/file${i}.ts`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => body("source\n".repeat(12000))),
    );
    const result = await fetchSourceContext({
      username: "owner",
      repo: "repo",
      githubData: repo(paths),
      selectedPaths: paths,
    });
    expect(result.paths).toHaveLength(12);
    expect(result.text.length).toBeLessThanOrEqual(MAX_SOURCE_CHARACTERS);
    expect(result.text).toContain("gaps omitted");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(200000))),
    );
    const oversized = await fetchSourceContext({
      username: "owner",
      repo: "repo",
      githubData: repo(),
      selectedPaths: ["src/main.ts"],
    });
    expect(oversized.paths).toEqual([]);
  });
  it("propagates caller cancellation instead of silently falling back", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort(new Error("cancelled"));
        throw controller.signal.reason;
      }),
    );
    await expect(
      fetchSourceContext({
        username: "owner",
        repo: "repo",
        githubData: repo(),
        selectedPaths: ["src/main.ts"],
        signal: controller.signal,
      }),
    ).rejects.toThrow("cancelled");
  });
  it("preserves a verified public fallback instead of reusing an expired caller token", async () => {
    const fetchMock = vi.fn(async (_input: string, _init: RequestInit) =>
      body("export const main = 1;"),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchSourceContext({
      username: "owner",
      repo: "repo",
      githubData: { ...repo(), usedPublicFallback: true },
      selectedPaths: ["src/main.ts"],
      githubPat: "expired-token",
    });
    expect(result.paths).toEqual(["src/main.ts"]);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      Authorization: "Bearer public-server-token",
    });
  });
});
