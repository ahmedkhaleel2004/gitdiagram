// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStoredDiagramState: vi.fn(),
  hasIndexedVideo: vi.fn(),
  cachedReads: [] as Array<{ key: string; tags?: string[] }>,
  videosOn: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache:
    (
      read: () => Promise<unknown>,
      keys: string[],
      options: { tags?: string[] },
    ) =>
    () => {
      mocks.cachedReads.push({ key: keys[0]!, tags: options.tags });
      return read();
    },
}));
vi.mock("~/server/storage/artifact-store", () => ({
  getStoredDiagramState: mocks.getStoredDiagramState,
}));
vi.mock("~/server/explainer/config", () => ({
  isVideoExplainerEnabled: () => mocks.videosOn,
}));
vi.mock("~/server/explainer/video-index", () => ({
  hasIndexedVideo: mocks.hasIndexedVideo,
}));
vi.mock("~/server/explainer/cache", () => ({
  videoSummaryTag: (owner: string, repo: string) =>
    `explainer-video-summary:${owner}/${repo}`,
}));

import { GET, revalidate } from "./route";

const call = (username: string, repo: string) =>
  GET(new Request(`https://gitdiagram.com/${username}/${repo}.md`), {
    params: Promise.resolve({ username, repo }),
  });

const stored = {
  diagram: 'flowchart TD\n  node_app["App"]',
  explanation: "Demo serves notes.",
  graph: {
    groups: [],
    nodes: [
      {
        id: "app",
        label: "App",
        type: "service",
        description: null,
        groupId: null,
        path: "app.py",
        shape: null,
      },
    ],
    edges: [],
  },
  latestSessionAudit: null,
  lastSuccessfulAt: "2026-09-19T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cachedReads.length = 0;
  mocks.videosOn = true;
  mocks.hasIndexedVideo.mockResolvedValue(false);
});

describe("repository Markdown", () => {
  it("serves a stored diagram as Markdown with the page as canonical", async () => {
    mocks.getStoredDiagramState.mockResolvedValue(stored);
    mocks.hasIndexedVideo.mockResolvedValue(true);
    const response = await call("acme", "demo");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response.headers.get("link")).toBe(
      '<https://gitdiagram.com/acme/demo>; rel="canonical"',
    );
    expect(response.headers.get("vary")).toBe("Accept");
    const body = await response.text();
    expect(body).toContain("# acme/demo architecture");
    expect(body).toContain("Demo serves notes.");
    expect(body).toContain("```mermaid");
    expect(body).toContain(
      "[App](https://github.com/acme/demo/blob/HEAD/app.py)",
    );
    expect(body).toContain("https://gitdiagram.com/acme/demo/video");
  });

  it("reads only the public artifact, through the page's cache and tags", async () => {
    mocks.getStoredDiagramState.mockResolvedValue(stored);
    await call("acme", "demo");

    expect(mocks.getStoredDiagramState).toHaveBeenCalledWith({
      username: "acme",
      repo: "demo",
    });
    expect(mocks.cachedReads).toEqual(
      expect.arrayContaining([
        {
          key: "public-diagram-state",
          tags: ["public-diagram-state:acme:demo"],
        },
        {
          key: "repository-markdown-video",
          tags: ["explainer-video-summary:acme/demo"],
        },
      ]),
    );
    expect(revalidate).toBe(21600);
  });

  it("answers 404 with instructions when no diagram is stored", async () => {
    mocks.getStoredDiagramState.mockResolvedValue(null);
    const response = await call("acme", "new");

    expect(response.status).toBe(404);
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(await response.text()).toContain(
      "open https://gitdiagram.com/acme/new in a browser",
    );
  });

  it("answers 503 when storage fails, and links no video when videos are off", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.videosOn = false;
    mocks.getStoredDiagramState.mockRejectedValue(new Error("R2 down"));
    const response = await call("acme", "demo");

    expect(response.status).toBe(503);
    expect(mocks.hasIndexedVideo).not.toHaveBeenCalled();
  });

  it("still serves the diagram when the video lookup fails", async () => {
    mocks.getStoredDiagramState.mockResolvedValue(stored);
    mocks.hasIndexedVideo.mockRejectedValue(new Error("Redis down"));
    const response = await call("acme", "demo");

    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("Video tour");
  });

  it("redirects mixed case and refuses names GitHub cannot have", async () => {
    const redirect = await call("Acme", "Demo");
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get("location")).toBe(
      "https://gitdiagram.com/acme/demo.md",
    );

    expect((await call("acme", "..")).status).toBe(404);
    expect((await call("a b", "demo")).status).toBe(404);
    expect(mocks.getStoredDiagramState).not.toHaveBeenCalled();
  });
});
