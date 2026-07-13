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

  if (message.includes("Cannot destructure property 'protocol'")) {
    return "Mermaid parser runtime failed in server context (location issue).";
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
let serverWindow: ReturnType<typeof parseHTML>["window"] | null = null;
let validationQueue: Promise<void> = Promise.resolve();

type ServerGlobalWithDom = typeof globalThis & {
  document?: unknown;
  window?: unknown;
};

function getServerWindow() {
  if (serverWindow) {
    return serverWindow;
  }

  const { window } = parseHTML("<!doctype html><html><body></body></html>");
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      host: "gitdiagram.local",
      hostname: "gitdiagram.local",
      href: "https://gitdiagram.local/",
      pathname: "/",
      port: "",
      protocol: "https:",
      search: "",
    },
  });
  serverWindow = window;
  return serverWindow;
}

function isLikelyServerDomWindow(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    document?: unknown;
    location?: {
      href?: unknown;
      protocol?: unknown;
    };
  };

  if (!candidate.document) {
    return false;
  }

  return (
    candidate.location === undefined ||
    typeof candidate.location.protocol !== "string" ||
    candidate.location.href === "https://gitdiagram.local/"
  );
}

function cleanStaleServerDomGlobals() {
  const serverGlobal = globalThis as ServerGlobalWithDom;
  if (isLikelyServerDomWindow(serverGlobal.window)) {
    Reflect.deleteProperty(serverGlobal, "window");
  }

  if (!serverGlobal.window && serverGlobal.document) {
    Reflect.deleteProperty(serverGlobal, "document");
  }
}

async function withServerDomGlobals<T>(callback: () => T | Promise<T>) {
  cleanStaleServerDomGlobals();

  const runtimeWindow = getServerWindow();
  const serverGlobal = globalThis as ServerGlobalWithDom;
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

  serverGlobal.window = runtimeWindow;
  serverGlobal.document = runtimeWindow.document;

  try {
    return await callback();
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
}

async function ensureDomPurifyPatched() {
  if (domPurifyPatched) {
    return;
  }

  const DOMPurify = (await import("dompurify")).default;
  const purify = DOMPurify(getServerWindow());
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

function serializeInProcessValidation<T>(
  callback: () => Promise<T>,
): Promise<T> {
  const result = validationQueue.then(callback, callback);
  validationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
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

    normalizedLines.push(
      "%% click directive omitted for server-side syntax validation %%",
    );
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

  return serializeInProcessValidation(async () => {
    try {
      return await withServerDomGlobals(async () => {
        const runtime = await ensureMermaidInitialized();
        await runtime.parse(serverParseDiagram.diagram);
        return { valid: true } satisfies MermaidValidationResult;
      });
    } catch (error) {
      return normalizeError(error);
    }
  });
}

export function formatValidationFeedback(
  result: MermaidValidationResult,
): string {
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
