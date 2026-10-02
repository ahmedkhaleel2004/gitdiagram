import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GithubData } from "./github";
import { fetchSourceContext, formatSourceIndex } from "./source-context";
import {
  MAX_SOURCE_CHARACTERS,
  MAX_SOURCE_FILE_BYTES,
} from "./repository-context";
vi.mock("../github-auth", () => ({
  getGitHubApiHeaders: async ({ githubPat }: { githubPat?: string }) => ({
    Authorization: `Bearer ${githubPat ?? "public-server-token"}`,
  }),
}));
afterEach(() => vi.unstubAllGlobals());
const source = "export const main = 1;";
const blobHash = (text: string) =>
  createHash("sha1")
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest("hex");
function repo(paths = ["src/main.ts"], text = source): GithubData {
  return {
    defaultBranch: "main",
    fileTree: paths.join("\n"),
    readme: "",
    isPrivate: false,
    stargazerCount: 0,
    pathTypes: new Map(paths.map((p) => [p, "blob"])),
    sourceBlobs: new Map(
      paths.map((p) => [
        p,
        { sha: blobHash(text), size: Buffer.byteLength(text) },
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
      githubData: { ...repo(), isPrivate: true },
      githubPat: "private-caller-token",
      selectedPaths: ["src/main.ts", "src/symlink.ts", ".env"],
    });
    expect(result.paths).toEqual(["src/main.ts"]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.github.com/repos/owner/repo/git/blobs/${blobHash(source)}`,
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      redirect: "manual",
      cache: "no-store",
      headers: { Authorization: "Bearer private-caller-token" },
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
        .mockResolvedValueOnce(new Response("\0binary")),
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
      vi.fn(async () => new Response("source\n".repeat(12000))),
    );
    const result = await fetchSourceContext({
      username: "owner",
      repo: "repo",
      githubData: repo(paths, "source\n".repeat(12000)),
      selectedPaths: paths,
    });
    expect(result.paths).toHaveLength(12);
    expect(result.text.length).toBeLessThanOrEqual(MAX_SOURCE_CHARACTERS);
    expect(result.text).toContain("gaps omitted");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(MAX_SOURCE_FILE_BYTES + 1))),
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
  it("reads public sources without sending caller or server credentials", async () => {
    const fetchMock = vi.fn(
      async (_input: string, _init: RequestInit) => new Response(source),
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
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://raw.githubusercontent.com/owner/repo/main/src/main.ts",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });
  it("rejects changed or malformed public content instead of mixing file versions", async () => {
    for (const bytes of [
      new TextEncoder().encode("different branch content"),
      new Uint8Array([0xc3, 0x28]),
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(bytes)),
      );
      const result = await fetchSourceContext({
        username: "owner",
        repo: "repo",
        githubData: repo(),
        selectedPaths: ["src/main.ts"],
      });
      expect(result.paths).toEqual([]);
      expect(result.unavailableCount).toBe(1);
    }
  });
  it("encodes branch and file names on public content URLs", async () => {
    const fetchMock = vi.fn(async () => new Response(source));
    vi.stubGlobal("fetch", fetchMock);
    const path = "src/a file.ts";
    const result = await fetchSourceContext({
      username: "owner",
      repo: "repo",
      githubData: { ...repo([path]), defaultBranch: "release/v2" },
      selectedPaths: [path],
    });
    expect(result.paths).toEqual([path]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/owner/repo/release%2Fv2/src/a%20file.ts",
      expect.objectContaining({ redirect: "manual" }),
    );
  });
  it("recovers immutable source after a branch move without leaking credentials to the CDN", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith("https://raw.")
        ? new Response("new branch content")
        : body(source),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchSourceContext({
      username: "owner",
      repo: "repo",
      githubData: repo(),
      selectedPaths: ["src/main.ts"],
    });
    expect(result.paths).toEqual(["src/main.ts"]);
    expect(result.text).toContain(source);
    expect(result.text).not.toContain("new branch content");
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.github.com/repos/owner/repo/git/blobs/${blobHash(source)}`,
      expect.objectContaining({
        redirect: "manual",
        headers: { Authorization: "Bearer public-server-token" },
      }),
    );
  });
  it("bounds branch-move recovery to two immutable blob requests", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith("https://raw.") ? new Response("changed") : body(source),
    );
    vi.stubGlobal("fetch", fetchMock);
    const paths = ["a.ts", "b.ts", "c.ts", "d.ts"];
    const result = await fetchSourceContext({
      username: "owner",
      repo: "repo",
      githubData: repo(paths),
      selectedPaths: paths,
    });
    expect(result.paths).toHaveLength(2);
    expect(result.unavailableCount).toBe(2);
    expect(
      fetchMock.mock.calls.filter(([url]) => url.startsWith("https://api."))
        .length,
    ).toBe(2);
  });
});

describe("source index", () => {
  function repoWith(files: Record<string, string>): GithubData {
    const paths = Object.keys(files);
    return {
      defaultBranch: "main",
      fileTree: paths.join("\n"),
      readme: "",
      isPrivate: false,
      stargazerCount: 0,
      pathTypes: new Map(paths.map((path) => [path, "blob"])),
      sourceBlobs: new Map(
        paths.map((path) => [
          path,
          {
            sha: blobHash(files[path]!),
            size: Buffer.byteLength(files[path]!),
          },
        ]),
      ),
    };
  }
  function serve(files: Record<string, string>) {
    const fetchMock = vi.fn(async (url: string) => {
      const path = decodeURIComponent(
        url.replace("https://raw.githubusercontent.com/owner/repo/main/", ""),
      );
      return path in files
        ? new Response(files[path])
        : new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("lists what each file read imports, what was read without an excerpt, and what was never opened", async () => {
    const files = {
      "src/main.ts": 'import { run } from "./engine";\nrun();',
      "src/engine.ts":
        'import { save } from "./store";\nexport const run = () => save();',
      "src/store.ts": "export const save = () => 1;",
      "src/unused.ts": "export const x = 1;",
    };
    const fetchMock = serve(files);
    const result = await fetchSourceContext({
      username: "owner",
      repo: "repo",
      githubData: repoWith(files),
      selectedPaths: ["src/main.ts"],
      referencePaths: ["src/unused.ts"],
      listedPaths: ["src/later.ts"],
    });
    // src/engine.ts was never ranked: it was read because src/main.ts
    // imports it. One hop only: src/store.ts is listed, not read.
    expect(result.readPaths).toEqual([
      "src/main.ts",
      "src/unused.ts",
      "src/engine.ts",
    ]);
    expect(result.references).toEqual({
      "src/main.ts": ["src/engine.ts"],
      "src/unused.ts": [],
      "src/engine.ts": ["src/store.ts"],
    });
    // One excerpt slot: the file something else uses wins it.
    expect(result.paths).toEqual(["src/engine.ts"]);
    expect(result.text.startsWith("SOURCE INDEX")).toBe(true);
    expect(result.text).toContain("END SOURCE INDEX");
    expect(result.text).toContain(
      "src/main.ts (0.1 KB, read) -> src/engine.ts",
    );
    expect(result.text).toContain(
      "src/engine.ts (0.1 KB, excerpt) -> src/store.ts",
    );
    expect(result.text).toContain('FILE "src/engine.ts"');
    expect(result.text).toContain("src/unused.ts (0.1 KB, read) -> none found");
    expect(result.text).toContain("src/store.ts (0.1 KB, not read)");
    // Listed paths must exist in the tree.
    expect(result.text).not.toContain("src/later.ts");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("excerpts the files others connect through before a stray script", async () => {
    const files = {
      "tools/script/Program.cs": "class Script { }",
      "Program.cs":
        "var bridge = new TelegramBridge(); var s = new SessionStore();",
      "TelegramBridge.cs": "class TelegramBridge { SessionStore store; }",
      "SessionStore.cs": "class SessionStore { }",
    };
    serve(files);
    const result = await fetchSourceContext({
      username: "owner",
      repo: "repo",
      githubData: repoWith(files),
      selectedPaths: ["tools/script/Program.cs", "Program.cs"],
      referencePaths: ["TelegramBridge.cs", "SessionStore.cs"],
    });
    expect(result.paths).toHaveLength(2);
    expect(result.paths).not.toContain("tools/script/Program.cs");
    expect(result.text).toContain(
      "tools/script/Program.cs (0.1 KB, read) -> none found",
    );
  });

  it("reads only the chosen files when a caller asks for no references", async () => {
    const files = {
      "src/main.ts": 'import "./engine";',
      "src/engine.ts": "export {};",
    };
    const fetchMock = serve(files);
    const result = await fetchSourceContext({
      username: "owner",
      repo: "repo",
      githubData: repoWith(files),
      selectedPaths: ["src/main.ts"],
    });
    expect(result.readPaths).toEqual(["src/main.ts"]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps the index within its budget, sorted by path", () => {
    const index = formatSourceIndex(
      Array.from({ length: 400 }, (_, number) => ({
        path: `src/module_${String(number).padStart(3, "0")}.ts`,
        size: 1200,
        status: "read" as const,
        references: ["src/a.ts", "src/b.ts"],
      })),
      2_000,
    );
    expect(index.length).toBeLessThanOrEqual(2_000);
    const lines = index.split("\n").slice(2, -1);
    expect(lines.length).toBeGreaterThan(3);
    expect([...lines].sort()).toEqual(lines);
    expect(formatSourceIndex([])).toBe("");
  });
});
