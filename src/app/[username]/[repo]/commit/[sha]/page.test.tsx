import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { cachedReads, getStoredDiagramState, permanentRedirect } = vi.hoisted(
  () => ({
    cachedReads: [] as Array<{ keys: string[]; tags?: string[] }>,
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
      options: { tags?: string[] },
    ) =>
    () => {
      cachedReads.push({ keys, tags: options.tags });
      return read();
    },
}));
vi.mock("next/navigation", () => ({ permanentRedirect }));
vi.mock("~/server/storage/artifact-store", () => ({ getStoredDiagramState }));
vi.mock("../../repo-page-client", () => ({ default: () => null }));

import RepoPageClient from "../../repo-page-client";
import CommitRepo, { generateMetadata } from "./page";

const FULL = "0123456789abcdef0123456789abcdef01234567";

type ClientProps = {
  username: string;
  repo: string;
  commit?: string;
  initialState: unknown;
  initialStateIsAuthoritative: boolean;
};

async function render(username: string, repo: string, sha: string) {
  const page = await CommitRepo({
    params: Promise.resolve({ username, repo, sha }),
  });
  expect(isValidElement(page)).toBe(true);
  const element = page as ReactElement<ClientProps>;
  expect(element.type).toBe(RepoPageClient);
  return element.props;
}

const storedState = {
  diagram: "flowchart TD\n  node_app[App]",
  explanation: "Demo at a commit.",
  graph: null,
  latestSessionAudit: null,
  lastSuccessfulAt: "2026-09-19T00:00:00Z",
  commit: FULL,
};

describe("commit page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cachedReads.length = 0;
  });

  it("server-renders a stored diagram for a full SHA from the commit's own key", async () => {
    getStoredDiagramState.mockResolvedValue(storedState);

    const props = await render("acme", "demo", FULL);

    expect(getStoredDiagramState).toHaveBeenCalledWith({
      username: "acme",
      repo: "demo",
      commit: FULL,
    });
    expect(props).toMatchObject({
      username: "acme",
      repo: "demo",
      commit: FULL,
      initialState: storedState,
      initialStateIsAuthoritative: true,
    });
    expect(cachedReads[0]?.keys).toEqual([
      "public-diagram-state",
      "acme",
      "demo",
      "commit",
      FULL,
    ]);
    expect(cachedReads[0]?.tags).toEqual([
      `public-diagram-state:acme:demo:commit:${FULL}`,
    ]);
  });

  it("leaves a full SHA with no stored diagram to the client", async () => {
    getStoredDiagramState.mockResolvedValue(null);

    const props = await render("acme", "demo", FULL);

    expect(props.initialState).toBeNull();
    expect(props.initialStateIsAuthoritative).toBe(false);
    expect(props.commit).toBe(FULL);
  });

  it("never reads storage or GitHub for a short SHA: the client resolves it", async () => {
    const props = await render("acme", "demo", FULL.slice(0, 7));

    expect(getStoredDiagramState).not.toHaveBeenCalled();
    expect(props).toMatchObject({
      commit: FULL.slice(0, 7),
      initialState: null,
      initialStateIsAuthoritative: false,
    });
  });

  it("hands a malformed SHA to the client so the API can explain it", async () => {
    const props = await render("acme", "demo", "main");

    expect(getStoredDiagramState).not.toHaveBeenCalled();
    expect(props.commit).toBe("main");
  });

  it("redirects mixed-case addresses to the lowercase path before reading", async () => {
    await expect(render("Acme", "Demo", FULL)).rejects.toThrow(
      `redirect:/acme/demo/commit/${FULL}`,
    );
    await expect(render("acme", "demo", FULL.toUpperCase())).rejects.toThrow(
      `redirect:/acme/demo/commit/${FULL}`,
    );
    expect(getStoredDiagramState).not.toHaveBeenCalled();
  });

  it("names the commit in the metadata, canonicalizes to it and keeps it out of the index", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ username: "acme", repo: "demo", sha: FULL }),
    });

    expect(metadata.title).toContain("acme/demo @ 0123456");
    expect(metadata.alternates?.canonical).toBe(`/acme/demo/commit/${FULL}`);
    expect(metadata.robots).toEqual({ index: false, follow: true });
    // Reuses the repository's picture; a commit has none of its own.
    expect(metadata.openGraph?.images).toEqual(metadata.twitter?.images);
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({
        url: "https://gitdiagram.com/acme/demo/opengraph-image",
      }),
    ]);
    expect(getStoredDiagramState).not.toHaveBeenCalled();
  });
});
