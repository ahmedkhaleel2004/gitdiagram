// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";

import { validateMermaidSyntax } from "~/server/generate/mermaid";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

async function expectRejectionWithin(
  promise: Promise<unknown>,
  expectedName: string,
  timeoutMs = 500,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const settlement = promise.then(
    () => ({ status: "resolved" as const }),
    (error: unknown) => ({ error, status: "rejected" as const }),
  );
  const deadline = new Promise<{ status: "deadline" }>((resolve) => {
    timeout = setTimeout(() => resolve({ status: "deadline" }), timeoutMs);
  });

  try {
    const result = await Promise.race([settlement, deadline]);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.error).toMatchObject({ name: expectedName });
    }
  } finally {
    clearTimeout(timeout);
  }
}

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

    const results = await Promise.all(
      diagrams.map((diagram) => validateMermaidSyntax(diagram)),
    );

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

  it("rejects promptly when cancelled while waiting for the DOM queue", async () => {
    await validateMermaidSyntax("flowchart TD\nA-->B");
    const runtime = (await import("mermaid")).default;
    const parser = vi.spyOn(runtime, "parse");
    const activeParse =
      createDeferred<Awaited<ReturnType<typeof runtime.parse>>>();
    parser.mockImplementationOnce(() => activeParse.promise);
    const activeValidation = validateMermaidSyntax("flowchart TD\nA-->B", {
      timeoutMs: 1_000,
    });

    try {
      await vi.waitFor(() => expect(parser).toHaveBeenCalledTimes(1));

      const controller = new AbortController();
      const queuedValidation = validateMermaidSyntax("flowchart TD\nC-->D", {
        signal: controller.signal,
        timeoutMs: 1_000,
      });
      const rejection = expectRejectionWithin(queuedValidation, "AbortError");
      controller.abort();

      await rejection;

      activeParse.resolve({ config: {}, diagramType: "flowchart-v2" });
      await expect(activeValidation).resolves.toEqual({ valid: true });
      await expect(
        validateMermaidSyntax("flowchart TD\nE-->F", { timeoutMs: 1_000 }),
      ).resolves.toEqual({ valid: true });

      // The cancelled queued request never entered Mermaid.parse. The third
      // validation proves the queue continued after skipping it.
      expect(parser).toHaveBeenCalledTimes(2);
    } finally {
      activeParse.resolve({ config: {}, diagramType: "flowchart-v2" });
      await activeValidation.catch(() => undefined);
      parser.mockRestore();
    }
  });

  it("rejects promptly on cancellation while Mermaid is still parsing", async () => {
    await validateMermaidSyntax("flowchart TD\nA-->B");
    const runtime = (await import("mermaid")).default;
    const parser = vi.spyOn(runtime, "parse");
    const activeParse =
      createDeferred<Awaited<ReturnType<typeof runtime.parse>>>();
    parser.mockImplementationOnce(() => activeParse.promise);
    const controller = new AbortController();
    const validation = validateMermaidSyntax("flowchart TD\nA-->B", {
      signal: controller.signal,
      timeoutMs: 1_000,
    });

    try {
      const rejection = expectRejectionWithin(validation, "AbortError");
      await vi.waitFor(() => expect(parser).toHaveBeenCalledTimes(1));
      controller.abort();

      await rejection;

      // Mermaid has no parser cancellation API. Its late failure remains
      // observed, releases the queue, and does not become an unhandled promise.
      activeParse.reject(new Error("late parser failure"));
      await expect(
        validateMermaidSyntax("flowchart TD\nC-->D", { timeoutMs: 1_000 }),
      ).resolves.toEqual({ valid: true });
      expect(parser).toHaveBeenCalledTimes(2);
    } finally {
      activeParse.resolve({ config: {}, diagramType: "flowchart-v2" });
      await validation.catch(() => undefined);
      parser.mockRestore();
    }
  });

  it("times out promptly while Mermaid is still parsing", async () => {
    await validateMermaidSyntax("flowchart TD\nA-->B");
    const runtime = (await import("mermaid")).default;
    const parser = vi.spyOn(runtime, "parse");
    const activeParse =
      createDeferred<Awaited<ReturnType<typeof runtime.parse>>>();
    parser.mockImplementationOnce(() => activeParse.promise);
    const validation = validateMermaidSyntax("flowchart TD\nA-->B", {
      timeoutMs: 20,
    });

    try {
      const rejection = expectRejectionWithin(validation, "TimeoutError");
      await vi.waitFor(() => expect(parser).toHaveBeenCalledTimes(1));
      await rejection;

      activeParse.resolve({ config: {}, diagramType: "flowchart-v2" });
      await expect(
        validateMermaidSyntax("flowchart TD\nC-->D", { timeoutMs: 1_000 }),
      ).resolves.toEqual({ valid: true });
      expect(parser).toHaveBeenCalledTimes(2);
    } finally {
      activeParse.resolve({ config: {}, diagramType: "flowchart-v2" });
      await validation.catch(() => undefined);
      parser.mockRestore();
    }
  });
});
