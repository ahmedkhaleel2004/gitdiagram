import DOMPurify from "dompurify";
import { parseHTML } from "linkedom";
import mermaid from "mermaid";

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

export interface MermaidValidationResult {
  valid: boolean;
  message?: string;
  line?: number;
  token?: string;
  expected?: string[];
}

let initialized = false;
let domPurifyPatched = false;

function ensureDomPurifyPatched() {
  if (domPurifyPatched) {
    return;
  }

  const { window } = parseHTML("<!doctype html><html><body></body></html>");
  const purify = DOMPurify(window);
  Object.assign(DOMPurify, purify);
  domPurifyPatched = true;
}

async function ensureMermaidInitialized() {
  ensureDomPurifyPatched();

  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
    });
    initialized = true;
  }

  return mermaid;
}

function normalizeError(error: unknown): MermaidValidationResult {
  const candidate = error as {
    message?: string;
    hash?: {
      line?: number;
      token?: string;
      expected?: string[];
    };
  };

  return {
    valid: false,
    message: normalizeParserMessage(candidate?.message),
    line: candidate?.hash?.line,
    token: candidate?.hash?.token,
    expected: candidate?.hash?.expected,
  };
}

export async function validateMermaidSyntax(
  diagram: string,
): Promise<MermaidValidationResult> {
  try {
    const runtime = await ensureMermaidInitialized();
    await runtime.parse(diagram);
    return { valid: true };
  } catch (error) {
    return normalizeError(error);
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
