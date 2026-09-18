import { describe, expect, it } from "vitest";
import {
  architectureOutputSchema,
  expandArchitectureGraph,
  readArchitectureProgress,
} from "./architecture-output";
import { diagramGraphSchema } from "~/features/diagram/graph";
import {
  buildFileTreeLookup,
  compileDiagramGraph,
  validateDiagramGraph,
} from "./graph";

it("accepts compact model output while preserving colored, linked, stored graphs", () => {
  const { graph } = architectureOutputSchema.parse({
    explanation: "A request is dispatched to the worker.",
    graph: {
      groups: [{ id: "runtime", label: "Processing" }],
      nodes: [
        {
          id: "request",
          label: "Request",
          groupId: null,
          path: null,
          shape: "circle",
        },
        {
          id: "worker",
          label: "Worker",
          groupId: "runtime",
          path: "src/worker.ts",
          shape: "box",
        },
      ],
      edges: [
        { from: "request", to: "worker", label: "dispatches", style: "dashed" },
      ],
    },
  });
  const expanded = expandArchitectureGraph(graph);
  expect(diagramGraphSchema.safeParse(expanded).success).toBe(true);
  expect(
    validateDiagramGraph(expanded, buildFileTreeLookup("src/worker.ts")).valid,
  ).toBe(true);
  const mermaid = compileDiagramGraph({
    graph: expanded,
    username: "owner",
    repo: "repo",
    branch: "main",
    pathTypes: new Map([["src/worker.ts", "blob"]]),
  });
  expect(mermaid).toContain("fill:#");
  expect(mermaid).toContain(
    "https://github.com/owner/repo/blob/main/src/worker.ts",
  );
  expect(mermaid).toContain("dispatches");
});

describe("streaming architecture overview", () => {
  it("decodes every possible chunk boundary without leaking JSON or graph content", () => {
    const expected =
      'Routes call "workers".\nWindows path: C:\\repo. Unicode: ✨';
    const encoded = JSON.stringify({
      explanation: expected,
      graph: { nodes: ["hidden"] },
    }).replace("✨", "\\u2728");
    let previous = "";
    for (let end = 0; end <= encoded.length; end++) {
      const progress = readArchitectureProgress(encoded.slice(0, end));
      expect(expected.startsWith(progress.text)).toBe(true);
      expect(progress.text.startsWith(previous)).toBe(true);
      previous = progress.text;
    }
    expect(readArchitectureProgress(encoded)).toEqual({
      text: expected,
      complete: true,
    });
  });
  it("does not treat quoted graph keys or escaped quotes as a field boundary", () => {
    const text = 'The "graph": { value is documentation, not a control field.';
    expect(
      readArchitectureProgress(
        JSON.stringify({ explanation: text, graph: {} }),
      ),
    ).toEqual({ text, complete: true });
    expect(
      readArchitectureProgress('{"graph":{},"explanation":"late"}'),
    ).toEqual({ text: "", complete: false });
  });
});
