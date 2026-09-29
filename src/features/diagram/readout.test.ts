import { describe, expect, it } from "vitest";
import type { DiagramStateResponse } from "~/features/diagram/types";
import {
  diagramReadout,
  diagramSourceLinks,
  explanationSummary,
  UNGROUPED_LABEL,
} from "./readout";

function state(
  overrides: Partial<DiagramStateResponse> = {},
): DiagramStateResponse {
  return {
    diagram: [
      "flowchart TD",
      '  click node_api "https://github.com/acme/demo/blob/dev/api/server.py"',
      '  click node_evil "https://github.com/other/repo/blob/main/x.py"',
    ].join("\n"),
    explanation: "Demo serves an API.",
    graph: {
      groups: [
        { id: "backend", label: "Backend", description: "Server side" },
        { id: "empty", label: "Empty", description: null },
      ],
      nodes: [
        {
          id: "api",
          label: "API\nserver",
          type: "service",
          description: "Answers requests",
          groupId: "backend",
          path: "api/server.py",
          shape: "box",
        },
        {
          id: "evil",
          label: "Worker",
          type: "worker",
          description: null,
          groupId: "backend",
          path: "jobs",
          shape: null,
        },
        {
          id: "user",
          label: "User",
          type: "actor",
          description: null,
          groupId: null,
          path: null,
          shape: "circle",
        },
      ],
      edges: [
        {
          from: "user",
          to: "api",
          label: "calls",
          description: "Over HTTPS",
          style: null,
        },
        {
          from: "api",
          to: "ghost",
          label: null,
          description: null,
          style: null,
        },
      ],
    },
    latestSessionAudit: null,
    lastSuccessfulAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("diagramReadout", () => {
  it("groups components the way the diagram does, ungrouped last", () => {
    const readout = diagramReadout(state(), "acme", "demo")!;
    expect(readout.groups.map((group) => group.label)).toEqual([
      "Backend",
      UNGROUPED_LABEL,
    ]);
    expect(readout.componentCount).toBe(3);
    expect(readout.groups[0]!.components[0]).toMatchObject({
      label: "API server",
      description: "Answers requests",
      // The compiled diagram's own link, on the branch it was made from.
      href: "https://github.com/acme/demo/blob/dev/api/server.py",
    });
  });

  it("links only into the repository, falling back to its default branch", () => {
    const [, worker] = diagramReadout(state(), "acme", "demo")!.groups[0]!
      .components;
    expect(worker!.href).toBe("https://github.com/acme/demo/tree/HEAD/jobs");
    expect(
      diagramSourceLinks(state().diagram!, "acme", "demo").has("evil"),
    ).toBe(false);
  });

  it("names both ends of each connection and drops dangling ones", () => {
    expect(diagramReadout(state(), "acme", "demo")!.connections).toEqual([
      {
        from: "User",
        to: "API server",
        label: "calls",
        description: "Over HTTPS",
      },
    ]);
  });

  it("converts older HTML explanations and needs a diagram", () => {
    expect(
      diagramReadout(
        state({ explanation: "<p>Uses <b>Redis</b></p>", graph: null }),
        "acme",
        "demo",
      ),
    ).toMatchObject({ explanation: "Uses **Redis**", groups: [] });
    expect(diagramReadout(state({ diagram: null }), "acme", "demo")).toBeNull();
  });
});

describe("explanationSummary", () => {
  it("takes whole sentences up to the limit, skipping headings", () => {
    const text = [
      "# Overview",
      "**Demo** is a Node.js service built on `v2.py` handlers. It stores notes in Redis. It also has a very long third sentence that pushes the summary well past the limit of one hundred and sixty characters.",
    ].join("\n");
    expect(explanationSummary(text)).toBe(
      "Demo is a Node.js service built on v2.py handlers. It stores notes in Redis.",
    );
  });

  it("cuts a single long sentence at a word", () => {
    const summary = explanationSummary(`${"word ".repeat(60)}end.`)!;
    expect(summary.length).toBeLessThanOrEqual(160);
    expect(summary.endsWith("word…")).toBe(true);
  });

  it("returns null without prose", () => {
    expect(explanationSummary("## Heading only")).toBeNull();
  });
});
