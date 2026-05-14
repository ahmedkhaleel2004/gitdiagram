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
});
