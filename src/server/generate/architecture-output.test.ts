import { describe, expect, it } from "vitest";
import { readArchitectureProgress } from "./architecture-output";

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
