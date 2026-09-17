import { describe, expect, it } from "vitest";
import { excerptSource } from "./source-excerpt";

describe("architecture excerpts", () => {
  it("preserves central service initialization that head/tail sampling loses", () => {
    const text = [
      "import AntManager;",
      ...Array.from({ length: 200 }, (_, i) => `// setup documentation ${i}`),
      "public void onCreate() {",
      "  manager = new AntManager(this);",
      "  manager.connect();",
      "}",
      ...Array.from({ length: 200 }, (_, i) => `// other documentation ${i}`),
    ].join("\n");
    const excerpt = excerptSource(text, 3000);
    expect(excerpt).toContain("manager = new AntManager(this);");
    expect(excerpt).toContain("manager.connect();");
    expect(excerpt).toContain("gaps omitted");
    expect(excerpt.length).toBeLessThanOrEqual(3000);
  });
  it("retains small files exactly and bounds even a single oversized line", () => {
    expect(excerptSource("export const run = () => 1;", 100)).toBe(
      "export const run = () => 1;",
    );
    expect(excerptSource("x".repeat(10000), 500).length).toBeLessThanOrEqual(
      500,
    );
  });
});
