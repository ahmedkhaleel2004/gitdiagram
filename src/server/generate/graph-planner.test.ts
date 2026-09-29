import { describe, expect, it, vi } from "vitest";
import type { DiagramGraph } from "~/features/diagram/graph";
import { buildFileTreeLookup } from "./graph";
import { generateValidatedGraph } from "./graph-planner";
import { createGenerationSessionAudit } from "./session-audit";

vi.mock("server-only", () => ({}));
vi.mock("./openai", () => ({
  generateStructuredOutput: vi.fn(async () => {
    throw new Error("the model must not be called for a repairable graph");
  }),
}));

const node = (id: string, path: string | null) => ({
  id,
  label: id,
  type: "component",
  description: null,
  groupId: null,
  path,
  shape: null,
});

function run(initialGraph: DiagramGraph) {
  return generateValidatedGraph({
    provider: "openai",
    model: "gpt-6-luna",
    sessionId: "session",
    explanation: "",
    initialGraph,
    fileTree: "README.md\nsrc/api.ts\nsrc/store.ts\nsrc/unread.ts",
    fileTreeLookup: buildFileTreeLookup(
      "README.md\nsrc/api.ts\nsrc/store.ts\nsrc/unread.ts",
    ),
    evidence: {
      readPaths: ["src/api.ts", "src/store.ts"],
      references: { "src/api.ts": ["src/store.ts"], "src/store.ts": [] },
    },
    signal: new AbortController().signal,
    audit: createGenerationSessionAudit({
      sessionId: "session",
      provider: "openai",
      model: "gpt-6-luna",
    }),
    complimentaryEstimate: null,
    accounting: {
      actualUsages: [],
      hasCompleteMeasuredUsage: true,
      completedUnmeasuredTokenEstimate: 0,
      pendingModelRequestTokenEstimate: 0,
    },
    validationCategoryCounts: {},
    recordTiming: () => {},
    send: async () => true,
  });
}

describe("graph acceptance with edge evidence", () => {
  it("strips invented and unseen citations, fills supported ones and audits both", async () => {
    const result = await run({
      groups: [],
      nodes: [
        node("api", "src/api.ts"),
        node("store", "src/store.ts"),
        node("user", null),
      ],
      edges: [
        {
          from: "api",
          to: "store",
          label: "writes",
          description: null,
          style: null,
          evidencePath: "src/imagined.ts",
        },
        {
          from: "user",
          to: "api",
          label: "calls",
          description: null,
          style: null,
          evidencePath: "src/unread.ts",
        },
        {
          from: "user",
          to: "api",
          label: "reads docs",
          description: null,
          style: "dashed",
          evidencePath: "README.md",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.edges.map((edge) => edge.evidencePath)).toEqual([
      "src/api.ts",
      null,
      "README.md",
    ]);
    const attempt = result.audit.graphAttempts[0]!;
    expect(attempt.status).toBe("succeeded");
    expect(attempt.strippedEvidenceCount).toBe(2);
    expect(attempt.filledEvidenceCount).toBe(1);
    expect(result.audit.graph).toEqual(result.graph);
  });
});
