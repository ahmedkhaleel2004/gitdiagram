// @vitest-environment node
import { describe, expect, it } from "vitest";

import { diagramGraphSchema } from "~/features/diagram/graph";
import {
  normalizeCliStructuredOutput,
  parseCliJsonObject,
} from "~/server/generate/openai";

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

  it("fills missing group labels, node labels, and node types from aliases", () => {
    const normalized = normalizeCliStructuredOutput("diagram_graph", {
      groups: [{ id: "Content Sources", name: "Content Sources" }],
      nodes: [
        {
          id: "Prompt Layer",
          title: "Prompt Layer",
          kind: "pipeline",
        },
      ],
      edges: [],
    });

    expect(normalized).toMatchObject({
      groups: [
        {
          id: "content_sources",
          label: "Content Sources",
          description: null,
        },
      ],
      nodes: [
        {
          id: "prompt_layer",
          label: "Prompt Layer",
          type: "pipeline",
          description: null,
          groupId: null,
          path: null,
          shape: null,
        },
      ],
      edges: [],
    });
  });

  it("repairs wrapped keys and edge aliases before schema validation", () => {
    const normalized = normalizeCliStructuredOutput("diagram_graph", {
      "gro ups": [{ id: "Source Material", "l abel": "Source Material" }],
      nodes: [
        {
          id: "Knowledge Bank",
          "l abel": "Knowledge Bank",
          group: "Source Material",
        },
      ],
      relationships: [
        {
          source: "Knowledge Bank",
          target: "Knowledge Bank",
        },
      ],
    });

    const result = diagramGraphSchema.safeParse(normalized);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.groups[0]?.id).toBe("source_material");
    expect(result.data.nodes[0]?.groupId).toBe("source_material");
    expect(result.data.edges[0]).toMatchObject({
      from: "knowledge_bank",
      to: "knowledge_bank",
    });
  });
});

describe("parseCliJsonObject", () => {
  it("repairs multiline CLI JSON strings and trailing commas", () => {
    const parsed = parseCliJsonObject(`{
  "nodes": [
    {
      "id": "api",
      "label": "API",
      "description": "Line 1
Line 2",
    }
  ]
}`);

    expect(parsed.rawText).toContain("\\n");
    expect(parsed.parsed).toEqual({
      nodes: [
        {
          id: "api",
          label: "API",
          description: "Line 1\nLine 2",
        },
      ],
    });
  });

  it("repairs loose quotes and raw tabs inside CLI JSON strings", () => {
    const parsed = parseCliJsonObject(`{
  "nodes": [
    {
      "id": "bundle",
      "label": "Threat "Model" Bundle",
      "description": "Exports\tsecurity artifacts"
    }
  ]
}`);

    expect(parsed.parsed).toEqual({
      nodes: [
        {
          id: "bundle",
          label: 'Threat "Model" Bundle',
          description: "Exports\tsecurity artifacts",
        },
      ],
    });
  });
});
