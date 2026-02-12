import { createRequire } from "node:module";

import DOMPurify from "dompurify";
import type { Mermaid as MermaidClient } from "mermaid";

const require = createRequire(import.meta.url);
let mermaidInstance: MermaidClient | null = null;
let initialized = false;
let domPurifyPatched = false;

interface DomPurifyLike {
  (window?: Window): unknown;
  sanitize?: (value: unknown, config?: unknown) => unknown;
  addHook?: (...args: unknown[]) => unknown;
}

function ensureDomPurifyPatched() {
  if (domPurifyPatched) return;

  try {
    const domPurify = DOMPurify as unknown as DomPurifyLike;
    if (typeof domPurify === "function" && typeof domPurify.sanitize !== "function") {
      const { JSDOM } = require("jsdom") as { JSDOM: new (html?: string) => { window: Window } };
      const domWindow = new JSDOM("<!doctype html><html><body></body></html>").window;
      const domPurifyInstance = domPurify(domWindow as unknown as Window) as Partial<DomPurifyLike>;
      Object.assign(domPurify, domPurifyInstance);
    }
  } catch {
    // Best effort patch.
  } finally {
    domPurifyPatched = true;
  }
}

async function getMermaid() {
  if (mermaidInstance) return mermaidInstance;

  ensureDomPurifyPatched();
  const mermaidModule = (await import("mermaid")) as { default: MermaidClient };
  mermaidInstance = mermaidModule.default;
  return mermaidInstance;
}

async function ensureMermaidInitialized() {
  const mermaid = await getMermaid();
  if (initialized) return mermaid;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
  });
  initialized = true;
  return mermaid;
}

function normalizeParserMessage(message?: string): string {
  if (!message) {
    return "Mermaid syntax is invalid and could not be parsed.";
  }

  if (
    message.includes("sanitize is not a function") ||
    message.includes("__TURBOPACK__imported__module")
  ) {
    return "Mermaid parser runtime failed in server context (sanitizer issue).";
  }

  return message;
}

interface MermaidErrorHash {
  line?: number;
  token?: string;
  expected?: string[];
}

interface MermaidParserError extends Error {
  hash?: MermaidErrorHash;
}

export interface MermaidValidationResult {
  valid: boolean;
  message?: string;
  line?: number;
  token?: string;
  expected?: string[];
}

export async function validateMermaidSyntax(
  diagram: string,
): Promise<MermaidValidationResult> {
  const mermaid = await ensureMermaidInitialized();
  try {
    await mermaid.parse(diagram);
    return { valid: true };
  } catch (error) {
    const parserError = error as MermaidParserError;
    return {
      valid: false,
      message: normalizeParserMessage(parserError?.message),
      line: parserError?.hash?.line,
      token: parserError?.hash?.token,
      expected: parserError?.hash?.expected,
    };
  }
}

export function formatValidationFeedback(result: MermaidValidationResult): string {
  if (result.valid) {
    return "No syntax errors found.";
  }

  const details = [
    `message: ${result.message ?? "unknown parse error"}`,
    typeof result.line === "number" ? `line: ${result.line}` : undefined,
    result.token ? `token: ${result.token}` : undefined,
    result.expected?.length
      ? `expected: ${result.expected.join(", ")}`
      : undefined,
  ].filter(Boolean);

  return details.join("\n");
}
