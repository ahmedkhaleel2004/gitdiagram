// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildFileTreeLookup,
  compileDiagramGraph,
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
  });
});

describe("compileDiagramGraph", () => {
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
    expect(diagram).toContain('click node_api "https://github.com/acme/demo/blob/main/src/api.ts"');
    expect(diagram).toContain('node_api -->|"dispatches"| node_worker');
    expect(diagram).toContain('node_api[("API<br/>[api.ts]")]');
    expect(diagram).not.toContain("(service)");
    expect(diagram).toContain('node_worker["Worker<br/>job runner"]');
    expect(diagram).toContain("classDef toneBlue");
    await expect(validateMermaidSyntax(diagram)).resolves.toMatchObject({ valid: true });
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
    expect(diagram).toContain('node_class --> node_end');
    expect(diagram).toContain('click node_class "https://github.com/acme/demo/blob/main/src/class.ts"');
    await expect(validateMermaidSyntax(diagram)).resolves.toMatchObject({ valid: true });
  });
});
