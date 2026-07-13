// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";

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

  it("rejects malformed click directives", async () => {
    const result = await validateMermaidSyntax("flowchart TD\nA-->B\nclick A");
    expect(result).toMatchObject({
      valid: false,
      line: 3,
      token: "click",
    });
  });

  it("safely serializes concurrent validation on a Fluid instance", async () => {
    const diagrams = Array.from({ length: 20 }, (_, index) =>
      index % 2 === 0
        ? `flowchart TD\nA${index}-->B${index}`
        : "flowchart TD\nA-=>B",
    );

    const results = await Promise.all(diagrams.map(validateMermaidSyntax));

    expect(results.filter((result) => result.valid)).toHaveLength(10);
    expect(results.filter((result) => !result.valid)).toHaveLength(10);
  });

  it("continues validating after a parser failure", async () => {
    const invalid = await validateMermaidSyntax("flowchart TD\nA-=>B");
    const valid = await validateMermaidSyntax("flowchart TD\nA-->B");

    expect(invalid.valid).toBe(false);
    expect(valid).toEqual({ valid: true });
  });

  it("does not leak fake browser globals into the server runtime", async () => {
    const serverGlobal = globalThis as typeof globalThis & {
      document?: unknown;
      window?: unknown;
    };
    const hadWindow = Object.prototype.hasOwnProperty.call(
      serverGlobal,
      "window",
    );
    const hadDocument = Object.prototype.hasOwnProperty.call(
      serverGlobal,
      "document",
    );
    const previousWindow = serverGlobal.window;
    const previousDocument = serverGlobal.document;

    Reflect.deleteProperty(serverGlobal, "window");
    Reflect.deleteProperty(serverGlobal, "document");

    try {
      const result = await validateMermaidSyntax("flowchart TD\nA-->B");

      expect(result.valid).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(serverGlobal, "window")).toBe(
        false,
      );
      expect(
        Object.prototype.hasOwnProperty.call(serverGlobal, "document"),
      ).toBe(false);
    } finally {
      if (hadWindow) {
        serverGlobal.window = previousWindow;
      }
      if (hadDocument) {
        serverGlobal.document = previousDocument;
      }
    }
  });

  it("cleans up stale fake browser globals from earlier validation runs", async () => {
    const serverGlobal = globalThis as typeof globalThis & {
      document?: unknown;
      window?: unknown;
    };
    const hadWindow = Object.prototype.hasOwnProperty.call(
      serverGlobal,
      "window",
    );
    const hadDocument = Object.prototype.hasOwnProperty.call(
      serverGlobal,
      "document",
    );
    const previousWindow = serverGlobal.window;
    const previousDocument = serverGlobal.document;
    const { window } = parseHTML("<!doctype html><html><body></body></html>");

    serverGlobal.window = window;
    serverGlobal.document = window.document;

    try {
      const result = await validateMermaidSyntax("flowchart TD\nA-->B");

      expect(result.valid).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(serverGlobal, "window")).toBe(
        false,
      );
      expect(
        Object.prototype.hasOwnProperty.call(serverGlobal, "document"),
      ).toBe(false);
    } finally {
      if (hadWindow) {
        serverGlobal.window = previousWindow;
      } else {
        Reflect.deleteProperty(serverGlobal, "window");
      }

      if (hadDocument) {
        serverGlobal.document = previousDocument;
      } else {
        Reflect.deleteProperty(serverGlobal, "document");
      }
    }
  });

  it("restores existing browser globals after success and failure", async () => {
    const serverGlobal = globalThis as typeof globalThis & {
      document?: unknown;
      window?: unknown;
    };
    const hadWindow = Object.prototype.hasOwnProperty.call(
      serverGlobal,
      "window",
    );
    const hadDocument = Object.prototype.hasOwnProperty.call(
      serverGlobal,
      "document",
    );
    const previousWindow = serverGlobal.window;
    const previousDocument = serverGlobal.document;
    const { window } = parseHTML("<!doctype html><html><body></body></html>");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        href: "https://existing.example/",
        protocol: "https:",
      },
    });

    serverGlobal.window = window;
    serverGlobal.document = window.document;

    try {
      const valid = await validateMermaidSyntax("flowchart TD\nA-->B");
      const invalid = await validateMermaidSyntax("flowchart TD\nA-=>B");

      expect(valid.valid).toBe(true);
      expect(invalid.valid).toBe(false);
      expect(serverGlobal.window).toBe(window);
      expect(serverGlobal.document).toBe(window.document);
    } finally {
      if (hadWindow) {
        serverGlobal.window = previousWindow;
      } else {
        Reflect.deleteProperty(serverGlobal, "window");
      }

      if (hadDocument) {
        serverGlobal.document = previousDocument;
      } else {
        Reflect.deleteProperty(serverGlobal, "document");
      }
    }
  });
});
