import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DIAGRAM_VIEW_URI,
  diagramViewHtml,
  diagramViewResourceMeta,
  mcpAppOrigin,
} from "./app";

describe("the diagram view resource", () => {
  it("is versioned in its URI", () => {
    expect(DIAGRAM_VIEW_URI).toMatch(/^ui:\/\/gitdiagram\/.+-v\d+\.html$/);
  });

  it("loads its script only from the origin its policy allows", () => {
    const origin = "https://preview.example.com";
    expect(diagramViewHtml(origin)).toContain(
      `<script type="module" src="${origin}/mcp-app/diagram-view.js"></script>`,
    );
    expect(diagramViewHtml(origin)).not.toMatch(/<script>(?!<\/script>)/);
    expect(diagramViewResourceMeta(origin).ui.csp).toEqual({
      resourceDomains: [origin],
      connectDomains: [],
    });
  });

  it("has the element the view script renders into", () => {
    expect(diagramViewHtml()).toContain('id="gitdiagram-view"');
  });
});

describe("mcpAppOrigin", () => {
  it("defaults to the site", () => {
    expect(mcpAppOrigin("")).toBe("https://gitdiagram.com");
    expect(mcpAppOrigin(undefined)).toBe("https://gitdiagram.com");
  });

  it("accepts an https origin, or http on localhost", () => {
    expect(mcpAppOrigin("https://abc.trycloudflare.com/path")).toBe(
      "https://abc.trycloudflare.com",
    );
    expect(mcpAppOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("refuses anything else", () => {
    expect(mcpAppOrigin("http://example.com")).toBe("https://gitdiagram.com");
    expect(mcpAppOrigin("javascript:alert(1)")).toBe("https://gitdiagram.com");
    expect(mcpAppOrigin("not a url")).toBe("https://gitdiagram.com");
  });
});
