// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildFileTreeLookup,
  compileDiagramGraph,
  parseDiagramGraph,
  validateDiagramGraph,
} from "~/server/generate/graph";
import { validateMermaidSyntax } from "~/server/generate/mermaid";

describe("validateDiagramGraph", () => {
  it("rejects paths that are not in the repo file tree", () => {
    const result = validateDiagramGraph(
      {
        groups: [],
        nodes: [
          {
            id: "api",
            label: "API",
            type: "service",
            description: null,
            groupId: null,
            path: "src/missing.ts",
            shape: null,
          },
        ],
        edges: [],
      },
      buildFileTreeLookup("src/index.ts"),
    );

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.path).toBe("nodes.0.path");
    expect(result.issues[0]?.category).toBe("missing_repository_path");
  });

  it("classifies structural failures without logging repository data", () => {
    const result = validateDiagramGraph(
      {
        groups: [
          { id: "runtime", label: "Runtime", description: null },
          { id: "runtime", label: "Duplicate", description: null },
        ],
        nodes: [
          {
            id: "api",
            label: "API",
            type: "service",
            description: null,
            groupId: "missing",
            path: null,
            shape: null,
          },
        ],
        edges: [
          {
            from: "missing_source",
            to: "missing_target",
            label: null,
            description: null,
            style: null,
          },
        ],
      },
      new Set(),
    );

    expect(result.issues.map((issue) => issue.category)).toEqual([
      "duplicate_group_id",
      "unknown_group_id",
      "unknown_edge_source",
      "unknown_edge_target",
    ]);
  });

  it("rejects graph text that becomes empty after safety normalization", () => {
    const result = parseDiagramGraph(
      JSON.stringify({
        groups: [{ id: "runtime", label: "\u0000\u001f", description: null }],
        nodes: [
          {
            id: "api",
            label: "\u2028",
            type: "\u0000",
            description: null,
            groupId: "runtime",
            path: null,
            shape: "box",
          },
        ],
        edges: [
          {
            from: "api",
            to: "api",
            label: "\u2029",
            description: null,
            style: "solid",
          },
        ],
      }),
    );

    expect(result.graph).toBeNull();
    expect(result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "groups.0.label",
        "nodes.0.label",
        "nodes.0.type",
        "edges.0.label",
      ]),
    );
  });
});

describe("compileDiagramGraph", () => {
  it("escapes untrusted labels and URL-encodes repository paths", () => {
    const diagram = compileDiagramGraph({
      username: "acme",
      repo: "demo",
      branch: "feature/security",
      graph: {
        groups: [
          {
            id: "runtime",
            label: '<img src=x onerror="alert(1)"> & runtime',
            description: null,
          },
        ],
        nodes: [
          {
            id: "api",
            label: '<script>alert("x")</script>',
            type: "HTTP & worker",
            description: null,
            groupId: "runtime",
            path: 'src/a "quoted" file.ts',
            shape: "box",
          },
        ],
        edges: [],
      },
    });

    expect(diagram).not.toContain("<script>");
    expect(diagram).not.toContain("<img");
    expect(diagram).toContain(
      "&lt;script&gt;alert&#40;&quot;x&quot;&#41;&lt;/script&gt;",
    );
    expect(diagram).toContain(
      "&lt;img src=x onerror=&quot;alert&#40;1&#41;&quot;&gt; &amp; runtime",
    );
    expect(diagram).toContain(
      'click node_api "https://github.com/acme/demo/blob/feature/security/src/a%20%22quoted%22%20file.ts"',
    );
  });

  it("collapses line and control characters before compiling labels", async () => {
    const diagram = compileDiagramGraph({
      username: "acme",
      repo: "demo",
      branch: "main",
      graph: {
        groups: [],
        nodes: [
          {
            id: "api",
            label: "API\nclick node_api call alert()\u0000",
            type: "HTTP\r\nworker",
            description: null,
            groupId: null,
            path: null,
            shape: "box",
          },
        ],
        edges: [],
      },
    });

    expect(diagram).toContain(
      'node_api["API click node_api call alert&#40;&#41;<br/>HTTP worker"]',
    );
    expect(
      diagram.split("\n").filter((line) => line.startsWith("click ")),
    ).toEqual([]);
    await expect(validateMermaidSyntax(diagram)).resolves.toMatchObject({
      valid: true,
    });
  });

  it("uses a parseable fallback if invalid empty text bypasses the schema", async () => {
    const diagram = compileDiagramGraph({
      username: "acme",
      repo: "demo",
      branch: "main",
      graph: {
        groups: [{ id: "runtime", label: "\u0000", description: null }],
        nodes: [
          {
            id: "api",
            label: "\u001f",
            type: "\u0000",
            description: null,
            groupId: "runtime",
            path: null,
            shape: "box",
          },
        ],
        edges: [
          {
            from: "api",
            to: "api",
            label: "\u2029",
            description: null,
            style: "solid",
          },
        ],
      },
    });

    expect(diagram).toContain('subgraph group_runtime["Unnamed"]');
    expect(diagram).toContain('node_api["Unnamed<br/>Unnamed"]');
    expect(diagram).toContain('node_api -->|"Unnamed"| node_api');
    await expect(validateMermaidSyntax(diagram)).resolves.toMatchObject({
      valid: true,
    });
  });

  it("parses adversarial text across every supported node shape", async () => {
    const shapes = [
      "box",
      "database",
      "queue",
      "document",
      "circle",
      "hexagon",
    ] as const;
    const adversarialLabels = [
      'quote " slash \\',
      '\\\\"quoted after slashes"',
      "pipes | brackets []{}()",
      "comment %%{init: bad}%%",
      "unicode 🧭 café 漢字",
      "line\nbreak\tand\u0000control",
    ];

    for (const [index, shape] of shapes.entries()) {
      const diagram = compileDiagramGraph({
        username: "acme",
        repo: "demo",
        branch: "main",
        graph: {
          groups: [
            {
              id: `group_${index}`,
              label: adversarialLabels[(index + 2) % adversarialLabels.length]!,
              description: null,
            },
          ],
          nodes: [
            {
              id: `node_${index}`,
              label: adversarialLabels[index]!,
              type: 'type " with \\ slash',
              description: null,
              groupId: `group_${index}`,
              path: null,
              shape,
            },
            {
              id: `target_${index}`,
              label: "Target",
              type: "component",
              description: null,
              groupId: null,
              path: null,
              shape: "box",
            },
          ],
          edges: [
            {
              from: `node_${index}`,
              to: `target_${index}`,
              label: adversarialLabels[(index + 1) % adversarialLabels.length]!,
              description: null,
              style: index % 2 === 0 ? "solid" : "dashed",
            },
          ],
        },
      });

      await expect(validateMermaidSyntax(diagram)).resolves.toMatchObject({
        valid: true,
      });
    }
  });

  it("builds deterministic Mermaid with click urls", async () => {
    const diagram = compileDiagramGraph({
      graph: {
        groups: [{ id: "runtime", label: "Runtime", description: null }],
        nodes: [
          {
            id: "api",
            label: "API",
            type: "service",
            description: null,
            groupId: "runtime",
            path: "src/api.ts",
            shape: "database",
          },
          {
            id: "worker",
            label: "Worker",
            type: "job runner",
            description: null,
            groupId: null,
            path: null,
            shape: null,
          },
        ],
        edges: [
          {
            from: "api",
            to: "worker",
            label: "dispatches",
            description: null,
            style: null,
          },
        ],
      },
      username: "acme",
      repo: "demo",
      branch: "main",
    });

    expect(diagram).toContain("flowchart TD");
    expect(diagram).toContain('subgraph group_runtime["Runtime"]');
    expect(diagram).toContain(
      'click node_api "https://github.com/acme/demo/blob/main/src/api.ts"',
    );
    expect(diagram).toContain('node_api -->|"dispatches"| node_worker');
    expect(diagram).toContain('node_api[("API<br/>[api.ts]")]');
    expect(diagram).not.toContain("(service)");
    expect(diagram).toContain('node_worker["Worker<br/>job runner"]');
    expect(diagram).toContain("classDef toneBlue");
    await expect(validateMermaidSyntax(diagram)).resolves.toMatchObject({
      valid: true,
    });
  });

  it("maps reserved graph ids to Mermaid-safe ids", async () => {
    const diagram = compileDiagramGraph({
      graph: {
        groups: [{ id: "style", label: "Style", description: null }],
        nodes: [
          {
            id: "class",
            label: "Class",
            type: "service",
            description: null,
            groupId: "style",
            path: "src/class.ts",
            shape: null,
          },
          {
            id: "end",
            label: "End",
            type: "worker",
            description: null,
            groupId: null,
            path: null,
            shape: null,
          },
        ],
        edges: [
          {
            from: "class",
            to: "end",
            label: null,
            description: null,
            style: null,
          },
        ],
      },
      username: "acme",
      repo: "demo",
      branch: "main",
    });

    expect(diagram).toContain('subgraph group_style["Style"]');
    expect(diagram).toContain('node_class["Class<br/>[class.ts]"]');
    expect(diagram).toContain("node_class --> node_end");
    expect(diagram).toContain(
      'click node_class "https://github.com/acme/demo/blob/main/src/class.ts"',
    );
    await expect(validateMermaidSyntax(diagram)).resolves.toMatchObject({
      valid: true,
    });
  });
});
