// @vitest-environment node
import { describe, expect, it } from "vitest";

import { diagramGraphSchema } from "~/features/diagram/graph";
import { normalizeCliStructuredOutput } from "~/server/generate/openai";

describe("normalizeCliStructuredOutput", () => {
  it("normalizes common CLI diagram graph variants before schema validation", () => {
    const normalized = normalizeCliStructuredOutput("diagram_graph", {
      groups: [{ id: "runtime", label: "Runtime" }],
      nodes: [
        {
          id: "API Service",
          label: "API",
          type: "service",
          groupId: "runtime",
          shape: "rectangle",
        },
      ],
      edges: [
        {
          source: "API Service",
          target: "Worker Service",
          style: "arrow",
        },
      ],
    });

    const result = diagramGraphSchema.safeParse(normalized);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.groups[0]?.description).toBeNull();
    expect(result.data.nodes[0]?.id).toBe("api_service");
    expect(result.data.nodes[0]?.shape).toBeNull();
    expect(result.data.nodes[0]?.groupId).toBe("runtime");
    expect(result.data.edges[0]?.from).toBe("api_service");
    expect(result.data.edges[0]?.to).toBe("worker_service");
    expect(result.data.edges[0]?.style).toBeNull();
  });
});
