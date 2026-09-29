import { describe, expect, it } from "vitest";
import { toTaggedMessage } from "./format";
import {
  SYSTEM_ARCHITECTURE_PROMPT,
  SYSTEM_FIRST_PROMPT,
  SYSTEM_GRAPH_PROMPT,
} from "./prompts";
import { formatSourceIndex } from "./source-context";

describe("evidence and coverage instructions", () => {
  it.each([
    ["single-pass architecture", SYSTEM_ARCHITECTURE_PROMPT],
    ["two-pass explanation", SYSTEM_FIRST_PROMPT],
  ])(
    "tells the %s model what the source index is and when to cite",
    (_, prompt) => {
      expect(prompt).toContain("SOURCE INDEX");
      // Citations only from what was shown; edges only from what was shown.
      expect(prompt).toMatch(/excerpt or read/);
      expect(prompt).toMatch(/README/);
      expect(prompt).toMatch(/names, folders/);
      // Coverage of core modules, and implementing files over barrels.
      expect(prompt).toMatch(/Every file on its CORE MODULES line/);
      expect(prompt).toMatch(/mod\.rs, __init__\.py, index\.ts/);
    },
  );

  it("has the single-pass model fill evidencePath and mark unverified edges", () => {
    expect(SYSTEM_ARCHITECTURE_PROMPT).toContain("evidencePath");
    expect(SYSTEM_ARCHITECTURE_PROMPT).toMatch(/Prefer leaving an edge out/);
    expect(SYSTEM_ARCHITECTURE_PROMPT).toMatch(
      /dashed with a null evidencePath/,
    );
  });

  it("has the graph planner copy the brief's evidence and mark inferred edges", () => {
    expect(SYSTEM_FIRST_PROMPT).toMatch(/evidence: <exact file path>/);
    expect(SYSTEM_FIRST_PROMPT).toMatch(/evidence: none \(inferred\)/);
    expect(SYSTEM_GRAPH_PROMPT).toContain("evidencePath");
    expect(SYSTEM_GRAPH_PROMPT).toMatch(/inferred as dashed/);
  });

  it("puts the source index at the top of the model's source files", () => {
    const index = formatSourceIndex([
      {
        path: "src/main.rs",
        size: 26_000,
        status: "excerpt",
        references: ["src/network/proxy.rs"],
      },
      { path: "src/network/proxy.rs", size: 127_000, status: "not read" },
    ]);
    const message = toTaggedMessage({
      file_tree: "src/main.rs\nsrc/network/proxy.rs",
      readme: "",
      source_files: `${index}\n\nFILE "src/main.rs"\nfn main() {}\nEND FILE`,
    });
    expect(message).toContain(
      "<source_files>\nSOURCE INDEX (computed by GitDiagram",
    );
    expect(message).toContain(
      "src/main.rs (26 KB, excerpt) -> src/network/proxy.rs",
    );
    expect(message).toContain("src/network/proxy.rs (127 KB, not read)");
  });
});
