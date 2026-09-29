import { describe, expect, it } from "vitest";
import type { DiagramGraph } from "~/features/diagram/graph";
import { applyEdgeEvidence } from "./edge-evidence";

const node = (id: string, path: string | null) => ({
  id,
  label: id,
  type: "component",
  description: null,
  groupId: null,
  path,
  shape: null,
});
const edge = (
  from: string,
  to: string,
  evidencePath?: string | null,
): DiagramGraph["edges"][number] => ({
  from,
  to,
  label: "calls",
  description: null,
  style: null,
  ...(evidencePath === undefined ? {} : { evidencePath }),
});

const tree = new Set([
  "README.md",
  "Program.cs",
  "SipBridge.cs",
  "SipVoiceAgent.cs",
  "WebClientUpdater.cs",
  "OfficeManager",
  "OfficeManager/game.js",
  "Unread.cs",
]);
const context = {
  readPaths: [
    "Program.cs",
    "SipBridge.cs",
    "SipVoiceAgent.cs",
    "WebClientUpdater.cs",
  ],
  references: {
    "Program.cs": ["SipBridge.cs", "WebClientUpdater.cs"],
    "SipBridge.cs": ["SipVoiceAgent.cs"],
    "SipVoiceAgent.cs": [],
    "WebClientUpdater.cs": [],
  },
};
const graph = (edges: DiagramGraph["edges"]): DiagramGraph => ({
  groups: [],
  nodes: [
    node("host", "Program.cs"),
    node("sip", "SipBridge.cs"),
    node("voice", "SipVoiceAgent.cs"),
    node("updater", "WebClientUpdater.cs"),
    node("office", "OfficeManager"),
    node("unread", "Unread.cs"),
    node("caller", null),
  ],
  edges,
});

describe("edge evidence", () => {
  it("keeps citations the model was shown and that belong to the relationship", () => {
    const result = applyEdgeEvidence(
      graph([
        edge("sip", "voice", "SipBridge.cs"),
        edge("caller", "sip", "README.md"),
        // Program.cs constructs both sides: the wiring file shows the link.
        edge("sip", "updater", "Program.cs"),
      ]),
      context,
      tree,
    );
    expect(result.graph.edges.map((entry) => entry.evidencePath)).toEqual([
      "SipBridge.cs",
      "README.md",
      "Program.cs",
    ]);
    expect(result.strippedEvidenceCount).toBe(0);
    expect(result.filledEvidenceCount).toBe(0);
  });

  it("drops citations of unread files and of files unrelated to either side", () => {
    const result = applyEdgeEvidence(
      graph([
        edge("updater", "office", "Unread.cs"),
        edge("updater", "office", "SipVoiceAgent.cs"),
      ]),
      context,
      tree,
    );
    // Nothing read connects the updater to OfficeManager, so nothing is filled.
    expect(result.graph.edges.map((entry) => entry.evidencePath)).toEqual([
      null,
      null,
    ]);
    expect(result.strippedEvidenceCount).toBe(2);
    expect(result.filledEvidenceCount).toBe(0);
  });

  it("fills an uncited edge from the reference lists, in either direction", () => {
    const result = applyEdgeEvidence(
      graph([
        edge("sip", "voice", null),
        // A returned result: the reference runs the other way.
        edge("voice", "sip"),
        edge("host", "host"),
        edge("caller", "sip", null),
      ]),
      context,
      tree,
    );
    expect(result.graph.edges.map((entry) => entry.evidencePath)).toEqual([
      "SipBridge.cs",
      "SipBridge.cs",
      "Program.cs",
      null,
    ]);
    expect(result.filledEvidenceCount).toBe(3);
  });

  it("returns the same graph object when nothing changes", () => {
    const input = graph([edge("sip", "voice", "SipBridge.cs")]);
    expect(applyEdgeEvidence(input, context, tree).graph).toBe(input);
  });
});
