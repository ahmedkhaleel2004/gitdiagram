import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

import { JsonLd } from "~/components/json-ld";
import RepoPageClient from "./repo-page-client";
import Repo, { generateMetadata } from "./page";

type ClientProps = {
  initialState: unknown;
  initialStateIsAuthoritative: boolean;
  readout?: ReactNode;
};

/** The page's children: its JSON-LD script and the client workspace. */
function parts(page: ReactElement) {
  const children = (page.props as { children: ReactNode[] }).children.filter(
    isValidElement,
  );
  const client = children.find((child) => child.type === RepoPageClient) as
    ReactElement<ClientProps> | undefined;
  const jsonLd = children.find((child) => child.type === JsonLd) as
    | ReactElement<{ data: { "@graph": Array<Record<string, unknown>> } }>
    | undefined;
  return { client: client!, jsonLd: jsonLd! };
}

const storedState = {
  diagram: [
    "flowchart TD",
    '  node_app["App"]',
    '  node_db[("Store")]',
    "  node_app --> node_db",
    '  click node_app "https://github.com/acme/demo/blob/main/src/app.ts"',
  ].join("\n"),
  explanation:
    "Demo is a small service that stores notes. Requests enter the app and are written to the store.",
  graph: {
    groups: [{ id: "core", label: "Core", description: "The service" }],
    nodes: [
      {
        id: "app",
        label: "App",
        type: "service",
        description: "Handles requests",
        groupId: "core",
        path: "src/app.ts",
        shape: "box",
      },
      {
        id: "db",
        label: "Store",
        type: "database",
        description: null,
        groupId: null,
        path: null,
        shape: "database",
      },
    ],
    edges: [
      {
        from: "app",
        to: "db",
        label: "writes notes",
        description: null,
        style: null,
      },
    ],
  },
  latestSessionAudit: null,
  lastSuccessfulAt: "2026-09-19T00:00:00Z",
};

describe("repository page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cachedReads.length = 0;
  });

  it("uses the same lowercase image URL for both social platforms", async () => {
    getStoredDiagramState.mockResolvedValue(null);
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

  it("titles and describes a stored diagram from its explanation", async () => {
    getStoredDiagramState.mockResolvedValue(storedState);
    const metadata = await generateMetadata({
      params: Promise.resolve({ username: "acme", repo: "demo" }),
    });

    expect(metadata.title).toBe(
      "acme/demo architecture diagram: how it works | GitDiagram",
    );
    expect(metadata.description).toBe(
      "Demo is a small service that stores notes. Requests enter the app and are written to the store.",
    );
    expect(metadata.alternates?.types).toEqual({
      "text/markdown": "/acme/demo.md",
    });
    expect(metadata.robots).toBeUndefined();
    // The page's own cached read: no second storage read.
    expect(cachedReads).toEqual([
      { key: "public-diagram-state", revalidate: 21600 },
    ]);
  });

  it("keeps a page with no diagram out of the index, but not after a failed read", async () => {
    getStoredDiagramState.mockResolvedValue(null);
    const none = await generateMetadata({
      params: Promise.resolve({ username: "acme", repo: "none" }),
    });
    expect(none.robots).toEqual({ index: false, follow: true });
    expect(none.description).toBe(
      "Interactive architecture diagram of acme/none: its main components, how they connect, and links to the source on GitHub.",
    );

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getStoredDiagramState.mockRejectedValue(new Error("R2 timed out"));
    const failed = await generateMetadata({
      params: Promise.resolve({ username: "acme", repo: "flaky" }),
    });
    expect(failed.robots).toBeUndefined();
  });

  it("redirects mixed-case pages before reading a diagram", async () => {
    await expect(
      Repo({ params: Promise.resolve({ username: "Acme", repo: "Demo" }) }),
    ).rejects.toThrow("redirect:/acme/demo");
    expect(getStoredDiagramState).not.toHaveBeenCalled();
  });

  it("keeps the initial diagram available without an additional client fetch", async () => {
    getStoredDiagramState.mockResolvedValue(storedState);
    const { client } = parts(
      await Repo({
        params: Promise.resolve({ username: "acme", repo: "demo" }),
      }),
    );

    expect(permanentRedirect).not.toHaveBeenCalled();
    expect(client.props.initialState).toBe(storedState);
    expect(client.props.initialStateIsAuthoritative).toBe(true);
    // A good page keeps the 6-hour lifetime.
    expect(cachedReads).toEqual([
      { key: "public-diagram-state", revalidate: 21600 },
    ]);
  });

  it("server-renders the explanation, components and connections as text", async () => {
    getStoredDiagramState.mockResolvedValue(storedState);
    const { client } = parts(
      await Repo({
        params: Promise.resolve({ username: "acme", repo: "demo" }),
      }),
    );
    const html = renderToStaticMarkup(<>{client.props.readout}</>);

    expect(html).toContain("How acme/demo works");
    expect(html).toContain("Demo is a small service that stores notes.");
    // Grouped components, linked to the diagram's own GitHub URL.
    expect(html).toContain(
      '<a href="https://github.com/acme/demo/blob/main/src/app.ts" target="_blank" rel="noopener noreferrer">App</a>',
    );
    expect(html).toContain("Handles requests");
    expect(html).toContain("Other components");
    expect(html).toContain("writes notes");
    expect(html).toContain('href="/acme/demo.md"');
    // Collapsed, not hidden: the lists sit in closed <details>.
    expect(html).not.toMatch(/display:\s*none|\shidden[=\s>]/);
  });

  it("describes the page as a TechArticle about the repository", async () => {
    getStoredDiagramState.mockResolvedValue(storedState);
    const { jsonLd } = parts(
      await Repo({
        params: Promise.resolve({ username: "acme", repo: "demo" }),
      }),
    );
    const graph = jsonLd.props.data["@graph"];

    expect(graph.map((node) => node["@type"])).toEqual([
      "TechArticle",
      "SoftwareSourceCode",
      "BreadcrumbList",
    ]);
    expect(graph[0]).toMatchObject({
      url: "https://gitdiagram.com/acme/demo",
      dateModified: "2026-09-19T00:00:00Z",
      about: { "@id": "https://gitdiagram.com/acme/demo#repository" },
    });
    expect(graph[1]).toMatchObject({
      codeRepository: "https://github.com/acme/demo",
    });
  });

  it("falls back to loading on the client when storage fails, caching that page briefly", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getStoredDiagramState.mockRejectedValue(new Error("R2 timed out"));
    const { client, jsonLd } = parts(
      await Repo({
        params: Promise.resolve({ username: "acme", repo: "demo" }),
      }),
    );

    expect(client.props.initialState).toBeNull();
    expect(client.props.initialStateIsAuthoritative).toBe(false);
    expect(client.props.readout).toBeUndefined();
    expect(jsonLd.props.data["@graph"][0]!["@type"]).toBe("WebPage");
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
