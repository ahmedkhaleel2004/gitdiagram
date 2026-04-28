import { parseHTML } from "linkedom";
import type mermaid from "mermaid";

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

const flowchartClickDirectivePattern =
  /^\s*click\s+[\w-]+\s+(?:(?:href\s+)?"[^"\n]*"|(?:call\s+)?[A-Za-z_$][\w$]*(?:\(\))?)(?:\s+"[^"\n]*")?(?:\s+_(?:blank|self|parent|top))?\s*$/;

let initialized = false;
let domPurifyPatched = false;
let mermaidRuntime: typeof mermaid | null = null;

async function ensureDomPurifyPatched() {
  if (domPurifyPatched) {
    return;
  }

  const { window } = parseHTML("<!doctype html><html><body></body></html>");
  const serverGlobal = globalThis as typeof globalThis & {
    document?: unknown;
    window?: unknown;
  };
  serverGlobal.window ??= window;
  serverGlobal.document ??= window.document;

  const DOMPurify = (await import("dompurify")).default;
  const purify = DOMPurify(window);
  Object.assign(DOMPurify, purify);
  domPurifyPatched = true;
}

async function ensureMermaidInitialized() {
  await ensureDomPurifyPatched();

  mermaidRuntime ??= (await import("mermaid")).default;

  if (!initialized) {
    mermaidRuntime.initialize({
      startOnLoad: false,
      securityLevel: "loose",
    });
    initialized = true;
  }

  return mermaidRuntime;
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

function buildServerParseDiagram(diagram: string): {
  diagram: string;
  issue?: MermaidValidationResult;
} {
  const lines = diagram.split("\n");
  const normalizedLines: string[] = [];

  for (const [index, line] of lines.entries()) {
    if (!line.trimStart().startsWith("click ")) {
      normalizedLines.push(line);
      continue;
    }

    if (!flowchartClickDirectivePattern.test(line)) {
      return {
        diagram,
        issue: {
          valid: false,
          message: "Mermaid click directive syntax is invalid.",
          line: index + 1,
          token: "click",
        },
      };
    }

    normalizedLines.push("%% click directive omitted for server-side syntax validation %%");
  }

  return { diagram: normalizedLines.join("\n") };
}

export async function validateMermaidSyntax(
  diagram: string,
): Promise<MermaidValidationResult> {
  const serverParseDiagram = buildServerParseDiagram(diagram);
  if (serverParseDiagram.issue) {
    return serverParseDiagram.issue;
  }

  try {
    const runtime = await ensureMermaidInitialized();
    await runtime.parse(serverParseDiagram.diagram);
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
