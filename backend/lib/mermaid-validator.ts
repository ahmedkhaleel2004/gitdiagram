import DOMPurify from "dompurify";
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

let initialized = false;
let domPurifyPatched = false;
let mermaidRuntime: typeof mermaid | null = null;
let serverWindow: ReturnType<typeof parseHTML>["window"] | null = null;

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

async function withServerDomGlobals<T>(callback: () => T | Promise<T>) {
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

function ensureDomPurifyPatched() {
  if (domPurifyPatched) {
    return;
  }

  const purify = DOMPurify(getServerWindow());
  Object.assign(DOMPurify, purify);
  domPurifyPatched = true;
}

async function ensureMermaidInitialized() {
  ensureDomPurifyPatched();

  mermaidRuntime ??= await withServerDomGlobals(
    async () => (await import("mermaid")).default,
  );
  const runtime = mermaidRuntime;

  if (!initialized) {
    await withServerDomGlobals(() => {
      runtime.initialize({
        startOnLoad: false,
        securityLevel: "loose",
      });
    });
    initialized = true;
  }

  return runtime;
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
    await withServerDomGlobals(() => runtime.parse(diagram));
    return { valid: true };
  } catch (error) {
    return normalizeError(error);
  }
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
