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
  it("keeps downstream domain calls instead of spending all evidence on setup", () => {
    const text = [
      'import { prepare, generate, persist } from "./workflow";',
      "export async function POST(request) {",
      ...Array.from({ length: 100 }, (_, i) => `  await setup${i}();`),
      "  const inputs = await prepare(request);",
      ...Array.from({ length: 100 }, (_, i) => `  // setup details ${i}`),
      "  const graph = await generate(inputs);",
      ...Array.from({ length: 100 }, (_, i) => `  // validation details ${i}`),
      "  await persist(graph);",
      "}",
    ].join("\n");
    const excerpt = excerptSource(text, 2200);
    expect(excerpt).toContain("const graph = await generate(inputs);");
    expect(excerpt).toContain("await persist(graph);");
    expect(excerpt).toContain('generate, persist from "./workflow"');
    expect(excerpt.length).toBeLessThanOrEqual(2200);
  });
  it("retains a called alias's declared module without inventing an import path", () => {
    const text = [
      'import { generate as render, unused, type Settings } from "@domain/engine";',
      ...Array.from({ length: 150 }, (_, i) => `// setup ${i}`),
      "const graph = render(input);",
      ...Array.from({ length: 150 }, (_, i) => `// other details ${i}`),
    ].join("\n");
    const excerpt = excerptSource(text, 1700);
    expect(excerpt).toContain('render from "@domain/engine"');
    expect(excerpt).toContain("const graph = render(input);");
    expect(excerpt).not.toContain('unused from "@domain/engine"');
  });
});
