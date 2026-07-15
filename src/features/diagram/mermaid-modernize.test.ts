import { describe, expect, it } from "vitest";

import { modernizeLegacyMermaidSource } from "~/features/diagram/mermaid-modernize";

describe("modernizeLegacyMermaidSource", () => {
  it("normalizes legacy identifiers without changing labels, links, or structure", () => {
    const source = [
      "graph TB",
      '  subgraph Client["Client Layer"]',
      '    CORE["FastAPI Application Core"]:::core',
      "    CLI[CLI Interface]:::utility",
      "  end",
      "  CORE --> CLI",
      '  click CORE "https://github.com/FastAPI/FastAPI/blob/master/fastapi/applications.py"',
      "  style Client fill:#fff,stroke:#000",
      "  class CORE,CLI core",
    ].join("\n");

    const result = modernizeLegacyMermaidSource(source);

    expect(result.source).toBe(
      [
        "flowchart TB",
        '  subgraph group_client["Client Layer"]',
        '    node_core["FastAPI Application Core"]:::core',
        "    node_cli[CLI Interface]:::utility",
        "  end",
        "  node_core --> node_cli",
        '  click node_core "https://github.com/FastAPI/FastAPI/blob/master/fastapi/applications.py"',
        "  style group_client fill:#fff,stroke:#000",
        "  class node_core,node_cli core",
      ].join("\n"),
    );
    expect(result).toMatchObject({
      changed: true,
      nodeCount: 2,
      groupCount: 1,
      clickCount: 1,
    });
  });

  it("assigns explicit current-format IDs to quoted subgraphs", () => {
    const result = modernizeLegacyMermaidSource(
      [
        "graph TB",
        '  subgraph "Frontend Layer"',
        '    App["App"]',
        "  end",
      ].join("\n"),
    );

    expect(result.source).toContain(
      'subgraph group_frontend_layer["Frontend Layer"]',
    );
    expect(result.source).toContain('node_app["App"]');
  });

  it("removes legacy init directives that the current renderer ignores", () => {
    const result = modernizeLegacyMermaidSource(
      [
        "%%{init: {",
        "  'theme': 'base'",
        "}}%%",
        "",
        "flowchart TB",
        'App["App"]',
      ].join("\n"),
    );

    expect(result.source).toBe(["flowchart TB", 'node_app["App"]'].join("\n"));
  });

  it("is idempotent for current-format Mermaid source", () => {
    const source = [
      "flowchart TB",
      'subgraph group_client["Client Layer"]',
      '  node_app["App"]',
      "end",
      'click node_app "https://github.com/acme/demo/blob/main/app.ts"',
    ].join("\n");

    const result = modernizeLegacyMermaidSource(source);

    expect(result.source).toBe(source);
    expect(result.changed).toBe(false);
  });

  it("rejects node identifiers that collapse to the same current-format ID", () => {
    expect(() =>
      modernizeLegacyMermaidSource(
        ["graph TB", 'FooBar["One"]', 'Foo_Bar["Two"]'].join("\n"),
      ),
    ).toThrow("Mermaid node identifiers collide at node_foo_bar");
  });
});
