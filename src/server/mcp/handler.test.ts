import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getPublicDiagramArtifact: vi.fn(),
  readVideoArtifact: vi.fn(),
  getCachedBrowsePage: vi.fn(),
  upstashEval: vi.fn(),
  emitLiveEvent: vi.fn(async () => undefined),
}));

vi.mock("~/lib/video-flag", () => ({ VIDEOS_ENABLED: true }));
vi.mock("~/server/storage/artifact-store", () => ({
  getPublicDiagramArtifact: mocks.getPublicDiagramArtifact,
}));
vi.mock("~/server/explainer/store", () => ({
  readVideoArtifact: mocks.readVideoArtifact,
}));
vi.mock("~/server/browse-index-cache", () => ({
  getCachedBrowsePage: mocks.getCachedBrowsePage,
}));
vi.mock("~/server/storage/upstash", () => ({
  upstashEval: mocks.upstashEval,
}));
vi.mock("~/server/admin/live-events", () => ({
  emitLiveEvent: mocks.emitLiveEvent,
  requestOrigin: () => ({
    country: "CA",
    region: "ON",
    city: "",
    device: "desktop",
  }),
}));

import { describeClient, handleMcpRequest } from "./handler";

const ARTIFACT = {
  username: "fastapi",
  repo: "fastapi",
  stargazerCount: 102536,
  lastSuccessfulAt: "2026-09-22T19:00:27.819Z",
  explanation: "FastAPI is a Python ASGI framework.",
  diagram: 'flowchart TD\n  node_app["FastAPI app"]',
  graph: {
    groups: [{ id: "runtime", label: "Request runtime", description: null }],
    nodes: [
      {
        id: "app",
        label: "FastAPI app",
        type: "component",
        description: null,
        groupId: "runtime",
        path: "fastapi/applications.py",
        shape: "box",
      },
    ],
    edges: [],
  },
};

/** An MCP client whose HTTP goes straight to the route handler. */
async function connect(mode: "legacy" | "auto" = "legacy") {
  const client = new Client(
    { name: "Claude Code", version: "1.0.0" },
    { versionNegotiation: { mode } },
  );
  const transport = new StreamableHTTPClientTransport(
    new URL("https://gitdiagram.com/mcp"),
    {
      fetch: (input, init) => {
        const request = new Request(input, init);
        request.headers.set("x-forwarded-for", "203.0.113.9");
        return handleMcpRequest(request);
      },
    },
  );
  await client.connect(transport);
  return client;
}

const textOf = (result: { content?: unknown }) =>
  (result.content as Array<{ type: string; text: string }>)
    .map((block) => block.text)
    .join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  // Rate limit: [allowed, ttl]; usage record: 1 (first notice).
  mocks.upstashEval.mockImplementation(async ({ keys }: { keys: string[] }) =>
    keys[0]?.startsWith("ratelimit:") ? [1, 3600] : 1,
  );
  mocks.readVideoArtifact.mockResolvedValue(null);
  mocks.getCachedBrowsePage.mockResolvedValue({ items: [], total: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MCP endpoint", () => {
  it.each(["legacy", "auto"] as const)(
    "lists the read-only tools (%s negotiation)",
    async (mode) => {
      const client = await connect(mode);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "find_repository_diagrams",
        "get_explainer_video",
        "get_repository_diagram",
      ]);
      for (const tool of tools)
        expect(tool.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
        });
      expect(client.getServerVersion()).toMatchObject({ name: "gitdiagram" });
      await client.close();
    },
  );

  it("returns a stored diagram from the public namespace only", async () => {
    mocks.getPublicDiagramArtifact.mockResolvedValue(ARTIFACT);
    // 2026-07-28 requests name their client, so the feed line can too.
    const client = await connect("auto");
    const result = await client.callTool({
      name: "get_repository_diagram",
      arguments: {
        repository: "https://github.com/FastAPI/fastapi/tree/master",
      },
    });
    expect(mocks.getPublicDiagramArtifact).toHaveBeenCalledWith(
      "FastAPI",
      "fastapi",
    );
    const text = textOf(result);
    expect(result.isError).toBeFalsy();
    expect(text).toContain("https://gitdiagram.com/fastapi/fastapi");
    expect(text).toContain("FastAPI is a Python ASGI framework.");
    expect(text).toContain("**FastAPI app** `fastapi/applications.py`");
    expect(text).toContain("```mermaid");
    await client.close();
    await vi.waitFor(() =>
      expect(mocks.emitLiveEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "mcp.call",
          tool: "get_repository_diagram",
          outcome: "found",
          repo: "fastapi/fastapi",
          client: "claude-code",
        }),
      ),
    );
  });

  it("attaches the diagram view to get_repository_diagram only", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect(byName.get("get_repository_diagram")?._meta).toMatchObject({
      ui: { resourceUri: "ui://gitdiagram/diagram-view-v1.html" },
      "openai/outputTemplate": "ui://gitdiagram/diagram-view-v1.html",
    });
    expect(byName.get("find_repository_diagrams")?._meta?.ui).toBeUndefined();
    expect(byName.get("get_explainer_video")?._meta?.ui).toBeUndefined();

    const { resources } = await client.listResources();
    expect(resources).toEqual([
      expect.objectContaining({
        uri: "ui://gitdiagram/diagram-view-v1.html",
        mimeType: "text/html;profile=mcp-app",
      }),
    ]);
    const { contents } = await client.readResource({
      uri: "ui://gitdiagram/diagram-view-v1.html",
    });
    const [view] = contents as unknown as Array<{
      mimeType: string;
      text: string;
      _meta: { ui: { csp: Record<string, string[]>; domain: string } };
    }>;
    expect(view?.mimeType).toBe("text/html;profile=mcp-app");
    expect(view?.text).toContain(
      '<script type="module" src="https://gitdiagram.com/mcp-app/diagram-view.js"></script>',
    );
    expect(view?._meta.ui).toMatchObject({
      csp: { resourceDomains: ["https://gitdiagram.com"], connectDomains: [] },
      domain: "https://gitdiagram.com",
    });
    await client.close();
  });

  it("hands the view the diagram in _meta, out of the model's text", async () => {
    mocks.getPublicDiagramArtifact.mockResolvedValue(ARTIFACT);
    const client = await connect();
    const result = await client.callTool({
      name: "get_repository_diagram",
      arguments: { repository: "FastAPI/fastapi" },
    });
    expect(result._meta?.["com.gitdiagram/diagram"]).toEqual({
      status: "found",
      repository: "fastapi/fastapi",
      diagramUrl: "https://gitdiagram.com/fastapi/fastapi",
      githubUrl: "https://github.com/fastapi/fastapi",
      stars: 102536,
      mermaid: ARTIFACT.diagram,
    });
    expect(result.structuredContent).toBeUndefined();
    await client.close();
  });

  it("never generates: a missing diagram points at the page that does", async () => {
    mocks.getPublicDiagramArtifact.mockResolvedValue(null);
    mocks.getCachedBrowsePage.mockResolvedValue({
      items: [
        {
          username: "tiangolo",
          repo: "fastapi-utils",
          stargazerCount: 10,
          lastSuccessfulAt: "2026-01-01T00:00:00Z",
        },
      ],
      total: 1,
    });
    const client = await connect();
    const result = await client.callTool({
      name: "get_repository_diagram",
      arguments: { repository: "someone/fastapi" },
    });
    const text = textOf(result);
    expect(text).toContain("no diagram of someone/fastapi yet");
    expect(text).toContain("https://gitdiagram.com/someone/fastapi");
    expect(text).toContain("tiangolo/fastapi-utils");
    expect(result._meta?.["com.gitdiagram/diagram"]).toEqual({
      status: "missing",
      repository: "someone/fastapi",
      diagramUrl: "https://gitdiagram.com/someone/fastapi",
      githubUrl: "https://github.com/someone/fastapi",
      stars: null,
      mermaid: null,
    });
    await client.close();
    await vi.waitFor(() =>
      expect(mocks.emitLiveEvent).toHaveBeenCalledWith(
        expect.not.objectContaining({ repo: expect.anything() }),
      ),
    );
  });

  it("refuses calls past the per-network limit", async () => {
    mocks.upstashEval.mockImplementation(
      async ({ keys }: { keys: string[] }) =>
        keys[0]?.startsWith("ratelimit:v2:mcp:203.0.113.9:") ? [0, 600] : 0,
    );
    const client = await connect();
    const result = await client.callTool({
      name: "get_repository_diagram",
      arguments: { repository: "fastapi/fastapi" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("about 10 minutes");
    expect(mocks.getPublicDiagramArtifact).not.toHaveBeenCalled();
    await client.close();
  });

  it("gives each person ChatGPT calls for their own allowance", async () => {
    mocks.getPublicDiagramArtifact.mockResolvedValue(ARTIFACT);
    const client = await connect();
    await client.callTool({
      name: "get_repository_diagram",
      arguments: { repository: "fastapi/fastapi" },
      _meta: { "openai/subject": "v1/anonymous-user-1" },
    });
    const keys = mocks.upstashEval.mock.calls
      .map(([call]) => (call as { keys: string[] }).keys[0] ?? "")
      .filter((key) => key.startsWith("ratelimit:"));
    expect(keys).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^ratelimit:v2:mcp-caller:203\.0\.113\.9:[0-9a-f]{24}:\d+$/,
        ),
        expect.stringMatching(/^ratelimit:v2:mcp-shared:203\.0\.113\.9:\d+$/),
      ]),
    );
    expect(keys.join(" ")).not.toContain("anonymous-user-1");
    await client.close();
  });

  it("refuses a named person past their own allowance", async () => {
    mocks.upstashEval.mockImplementation(
      async ({ keys }: { keys: string[] }) =>
        keys[0]?.startsWith("ratelimit:v2:mcp-caller:")
          ? [0, 120]
          : keys[0]?.startsWith("ratelimit:")
            ? [1, 3600]
            : 0,
    );
    const client = await connect();
    const result = await client.callTool({
      name: "get_repository_diagram",
      arguments: { repository: "fastapi/fastapi" },
      _meta: { "openai/subject": "v1/anonymous-user-2" },
    });
    expect(result.isError).toBe(true);
    expect(mocks.getPublicDiagramArtifact).not.toHaveBeenCalled();
    await client.close();
  });

  it("marks input that is not a repository as an error", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "get_repository_diagram",
      arguments: { repository: "how does react work" },
    });
    expect(result.isError).toBe(true);
    expect(mocks.getPublicDiagramArtifact).not.toHaveBeenCalled();
    await client.close();
  });

  it("searches the browse index by stars", async () => {
    mocks.getCachedBrowsePage.mockResolvedValue({
      items: Array.from({ length: 20 }, (_, index) => ({
        username: "vercel",
        repo: `repo-${index}`,
        stargazerCount: 100 - index,
        lastSuccessfulAt: "2026-01-01T00:00:00Z",
      })),
      total: 42,
    });
    const client = await connect();
    const result = await client.callTool({
      name: "find_repository_diagrams",
      arguments: { query: "github.com/vercel", limit: 3 },
    });
    expect(mocks.getCachedBrowsePage).toHaveBeenCalledWith({
      q: "vercel",
      sort: "stars_desc",
    });
    const text = textOf(result);
    expect(text).toContain("3 of 42");
    expect(text).toContain("https://gitdiagram.com/vercel/repo-2");
    expect(text).not.toContain("repo-3");
    await client.close();
  });

  it("reports an unreadable store as a tool error, not a crash", async () => {
    mocks.getPublicDiagramArtifact.mockRejectedValue(new Error("R2 down"));
    const client = await connect();
    const result = await client.callTool({
      name: "get_repository_diagram",
      arguments: { repository: "fastapi/fastapi" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("could not read");
    await client.close();
  });
});

describe("plain HTTP", () => {
  it("answers CORS preflights", async () => {
    const response = await handleMcpRequest(
      new Request("https://gitdiagram.com/mcp", {
        method: "OPTIONS",
        headers: { Origin: "https://example.com" },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("tells a person opening the URL how to connect", async () => {
    const response = await handleMcpRequest(
      new Request("https://gitdiagram.com/mcp", {
        headers: { Accept: "text/html" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("claude mcp add --transport http");
  });

  it("refuses 2025-era session streams (stateless server)", async () => {
    const response = await handleMcpRequest(
      new Request("https://gitdiagram.com/mcp", {
        headers: { Accept: "text/event-stream" },
      }),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("describeClient", () => {
  it("reads the name from a 2025-era initialize", () => {
    expect(
      describeClient({
        method: "initialize",
        params: { clientInfo: { name: "Cursor Agent" } },
      }),
    ).toEqual({ name: "cursor-agent", handshake: true });
  });

  it("reads the name from a 2026-07-28 request envelope", () => {
    expect(
      describeClient({
        method: "tools/call",
        params: {
          _meta: { "io.modelcontextprotocol/clientInfo": { name: "codex" } },
        },
      }),
    ).toEqual({ name: "codex", handshake: false });
  });

  it("tolerates anything else", () => {
    expect(describeClient(undefined)).toEqual({ name: null, handshake: false });
    expect(describeClient("x")).toEqual({ name: null, handshake: false });
  });
});
