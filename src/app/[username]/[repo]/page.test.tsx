import { beforeEach, describe, expect, it, vi } from "vitest";

const { cachedReads, getStoredDiagramState, permanentRedirect } = vi.hoisted(
  () => ({
    cachedReads: [] as Array<{ key: string; revalidate: number }>,
    getStoredDiagramState: vi.fn(),
    permanentRedirect: vi.fn((path: string) => {
      throw new Error(`redirect:${path}`);
    }),
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache:
    (
      read: () => Promise<unknown>,
      keys: string[],
      options: { revalidate: number },
    ) =>
    () => {
      cachedReads.push({ key: keys[0]!, revalidate: options.revalidate });
      return read();
    },
}));
vi.mock("next/navigation", () => ({ permanentRedirect }));
vi.mock("~/server/storage/artifact-store", () => ({ getStoredDiagramState }));
vi.mock("./repo-page-client", () => ({ default: () => null }));

import Repo, { generateMetadata } from "./page";

describe("repository cache URLs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cachedReads.length = 0;
  });

  it("uses the same lowercase image URL for both social platforms", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ username: "Acme", repo: "Demo" }),
    });

    expect(metadata.alternates?.canonical).toBe("/acme/demo");
    expect(metadata.openGraph?.images).toEqual(metadata.twitter?.images);
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({
        url: "https://gitdiagram.com/acme/demo/opengraph-image",
        width: 1200,
        height: 630,
      }),
    ]);
  });

  it("redirects mixed-case pages before reading a diagram", async () => {
    await expect(
      Repo({ params: Promise.resolve({ username: "Acme", repo: "Demo" }) }),
    ).rejects.toThrow("redirect:/acme/demo");
    expect(getStoredDiagramState).not.toHaveBeenCalled();
  });

  it("keeps the initial diagram available without an additional client fetch", async () => {
    const state = {
      diagram: "flowchart TD; A-->B",
      explanation: "Overview",
      graph: { groups: [], nodes: [], edges: [] },
      latestSessionAudit: null,
      lastSuccessfulAt: "2026-09-19T00:00:00Z",
    };
    getStoredDiagramState.mockResolvedValue(state);
    const page = await Repo({
      params: Promise.resolve({ username: "acme", repo: "demo" }),
    });

    expect(permanentRedirect).not.toHaveBeenCalled();
    expect(page.props.initialState).toBe(state);
    expect(page.props.initialStateIsAuthoritative).toBe(true);
    // A good page keeps the 6-hour lifetime.
    expect(cachedReads).toEqual([
      { key: "public-diagram-state", revalidate: 21600 },
    ]);
  });

  it("falls back to loading on the client when storage fails, caching that page briefly", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getStoredDiagramState.mockRejectedValue(new Error("R2 timed out"));
    const page = await Repo({
      params: Promise.resolve({ username: "acme", repo: "demo" }),
    });

    expect(page.props.initialState).toBeNull();
    expect(page.props.initialStateIsAuthoritative).toBe(false);
    // The shortest revalidate read during a render sets the page's lifetime.
    expect(cachedReads).toEqual([
      { key: "public-diagram-state", revalidate: 21600 },
      { key: "repo-page-storage-failure", revalidate: 60 },
    ]);
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0]![0])).toEqual({
      event: "repo_page.stored_state_failed",
      repository: "acme/demo",
      error: "R2 timed out",
    });
  });
});
