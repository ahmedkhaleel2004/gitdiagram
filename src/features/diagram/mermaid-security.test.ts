import { describe, expect, it } from "vitest";

import {
  enforceSafeMermaidLinks,
  sanitizeMermaidSourceForRender,
} from "~/features/diagram/mermaid-security";

describe("sanitizeMermaidSourceForRender", () => {
  it("removes config directives and unsafe callbacks while preserving generated GitHub links", () => {
    const source = [
      "%%{init:",
      "  {'securityLevel': 'loose'}",
      "}%%",
      "flowchart TD",
      'click node_safe "https://github.com/acme/demo/blob/main/src/a.ts"',
      'click CORE "https://github.com/FastAPI/FastAPI/blob/master/fastapi/applications.py"',
      "click node_bad call alert()",
      'click node_bad "javascript:alert(1)"',
    ].join("\n");

    expect(sanitizeMermaidSourceForRender(source)).toBe(
      [
        "flowchart TD",
        'click node_safe "https://github.com/acme/demo/blob/main/src/a.ts"',
        'click CORE "https://github.com/FastAPI/FastAPI/blob/master/fastapi/applications.py"',
      ].join("\n"),
    );
  });
});

describe("enforceSafeMermaidLinks", () => {
  it("keeps only HTTPS GitHub links", () => {
    const root = document.createElement("div");
    root.innerHTML = [
      '<a id="safe" href="https://github.com/acme/demo">safe</a>',
      '<a id="unsafe" href="https://example.com/phish">unsafe</a>',
    ].join("");

    enforceSafeMermaidLinks(root);

    expect(root.querySelector("#safe")?.getAttribute("href")).toBe(
      "https://github.com/acme/demo",
    );
    expect(root.querySelector("#safe")?.getAttribute("rel")).toBe(
      "noopener noreferrer",
    );
    expect(root.querySelector("#unsafe")?.hasAttribute("href")).toBe(false);
  });
});
