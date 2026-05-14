import { spawn } from "node:child_process";
import { parseHTML } from "linkedom";
import type mermaid from "mermaid";

const MERMAID_VALIDATION_TIMEOUT_MS = 15_000;

const childMermaidValidationScript = `
import { stdin, stdout } from "node:process";
import { parseHTML } from "linkedom";

function normalizeParserMessage(message) {
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

function normalizeError(error) {
  const candidate = error ?? {};
  return {
    valid: false,
    message: normalizeParserMessage(candidate.message),
    line: candidate.hash?.line,
    token: candidate.hash?.token,
    expected: candidate.hash?.expected,
  };
}

let diagram = "";
for await (const chunk of stdin) {
  diagram += chunk;
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

const DOMPurify = (await import("dompurify")).default;
const purify = DOMPurify(window);
Object.assign(DOMPurify, purify);
globalThis.window = window;
globalThis.document = window.document;

try {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
  });
  await mermaid.parse(diagram);
  stdout.write(JSON.stringify({ valid: true }));
} catch (error) {
  stdout.write(JSON.stringify(normalizeError(error)));
}
`;

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

function isMermaidRuntimeFailure(result: MermaidValidationResult): boolean {
  return (
    !result.valid &&
    (result.message?.startsWith(
      "Mermaid parser runtime failed in server context",
    ) ??
      false)
  );
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
  cleanStaleServerDomGlobals();
  await ensureDomPurifyPatched();

  mermaidRuntime ??= await withServerDomGlobals(
    async () => (await import("mermaid")).default,
  );

  if (!initialized) {
    await withServerDomGlobals(() => {
      mermaidRuntime?.initialize({
        startOnLoad: false,
        securityLevel: "loose",
      });
    });
    initialized = true;
  }

  return mermaidRuntime;
}

async function validateMermaidSyntaxInSubprocess(
  diagram: string,
): Promise<MermaidValidationResult> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", childMermaidValidationScript],
      {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (result: MermaidValidationResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      settle({
        valid: false,
        message: `Mermaid validation fallback timed out after ${MERMAID_VALIDATION_TIMEOUT_MS / 1000} seconds.`,
      });
    }, MERMAID_VALIDATION_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      settle({
        valid: false,
        message: normalizeParserMessage(error.message),
      });
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      if (code !== 0 && !stdout.trim()) {
        settle({
          valid: false,
          message: normalizeParserMessage(
            stderr.trim() || "Mermaid validation fallback failed.",
          ),
        });
        return;
      }

      try {
        settle(JSON.parse(stdout) as MermaidValidationResult);
      } catch {
        settle({
          valid: false,
          message: normalizeParserMessage(
            stderr.trim() ||
              "Mermaid validation fallback returned invalid JSON.",
          ),
        });
      }
    });

    child.stdin.end(diagram);
  });
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

  try {
    const runtime = await ensureMermaidInitialized();
    await runtime.parse(serverParseDiagram.diagram);
    return { valid: true };
  } catch (error) {
    const result = normalizeError(error);
    if (isMermaidRuntimeFailure(result)) {
      return validateMermaidSyntaxInSubprocess(serverParseDiagram.diagram);
    }

    return result;
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
