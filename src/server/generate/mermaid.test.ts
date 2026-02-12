import { describe, expect, it } from "vitest";

import { validateMermaidSyntax } from "~/server/generate/mermaid";

describe("validateMermaidSyntax", () => {
  it("accepts valid Mermaid flowchart syntax", async () => {
    const result = await validateMermaidSyntax("flowchart TD\nA-->B");
    expect(result.valid).toBe(true);
  });

  it("rejects invalid Mermaid flowchart syntax", async () => {
    const result = await validateMermaidSyntax("flowchart TD\nA-=>B");
    expect(result.valid).toBe(false);
    expect(result.message).toBeTruthy();
  });
});
