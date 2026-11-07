import { isValidElement, type ReactElement } from "react";
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
vi.mock("../../repo-page-client", () => ({ default: () => null }));

import BranchRepoPage, { generateMetadata } from "./page";

type ClientProps = {
  username: string;
  repo: string;
  branch: string;
  initialState: unknown;
  initialStateIsAuthoritative: boolean;
};

const storedState = {
  diagram: "flowchart TD\n  node_a --> node_b",
  explanation: "Branch explanation",
  graph: null,
  latestSessionAudit: null,
  lastSuccessfulAt: "2026-09-19T00:00:00Z",
};

describe("BranchRepoPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects uppercase username or repo to canonical path", async () => {
    await expect(
      BranchRepoPage({
        params: Promise.resolve({
          username: "Acme",
          repo: "Demo",
          branch: ["feature", "awesome"],
        }),
      }),
    ).rejects.toThrow("redirect:/acme/demo/tree/feature/awesome");
  });

  it("renders RepoPageClient with branch state and branch prop", async () => {
    getStoredDiagramState.mockResolvedValueOnce(storedState);
    const element = await BranchRepoPage({
      params: Promise.resolve({
        username: "acme",
        repo: "demo",
        branch: ["v5"],
      }),
    });

    expect(isValidElement(element)).toBe(true);
    const props = (element as ReactElement<ClientProps>).props;
    expect(props.username).toBe("acme");
    expect(props.repo).toBe("demo");
    expect(props.branch).toBe("v5");
    expect(props.initialState).toEqual(storedState);
    expect(props.initialStateIsAuthoritative).toBe(true);
  });

  it("generates metadata with branch in title and canonical URL", async () => {
    getStoredDiagramState.mockResolvedValueOnce(storedState);
    const meta = await generateMetadata({
      params: Promise.resolve({
        username: "acme",
        repo: "demo",
        branch: ["release", "v2"],
      }),
    });

    expect(meta.title).toBe(
      "acme/demo (release/v2) Architecture Diagram | GitDiagram",
    );
    expect(meta.alternates?.canonical).toBe("/acme/demo/tree/release/v2");
    expect(meta.openGraph?.url).toBe(
      "https://gitdiagram.com/acme/demo/tree/release/v2",
    );
  });
});
