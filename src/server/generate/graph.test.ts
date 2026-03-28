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
    expect(diagram).toContain('subgraph "Runtime"');
    expect(diagram).toContain('click api "https://github.com/acme/demo/blob/main/src/api.ts"');
    expect(diagram).toContain('api -->|"dispatches"| worker');
    expect(diagram).toContain('api[("API<br/>[api.ts]")]');
    expect(diagram).not.toContain("(service)");
    expect(diagram).toContain('worker["Worker<br/>job runner"]');
    expect(diagram).toContain("classDef toneBlue");
    await expect(validateMermaidSyntax(diagram)).resolves.toMatchObject({ valid: true });
  });
});
