import { JSDOM } from "jsdom";
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

export interface MermaidValidationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_VALIDATION_TIMEOUT_MS = 10_000;

const flowchartClickDirectivePattern =
  /^\s*click\s+[\w-]+\s+(?:(?:href\s+)?"[^"\n]*"|(?:call\s+)?[A-Za-z_$][\w$]*(?:\(\))?)(?:\s+"[^"\n]*")?(?:\s+_(?:blank|self|parent|top))?\s*$/;

let initialized = false;
let mermaidRuntime: typeof mermaid | null = null;
let serverDom: JSDOM | null = null;
let validationQueue: Promise<void> = Promise.resolve();

type ServerGlobalWithDom = {
  document?: unknown;
  window?: unknown;
};

function getServerWindow() {
  if (serverDom) {
    return serverDom.window;
  }

  serverDom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://gitdiagram.local/",
  });
  return serverDom.window;
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
  const serverGlobal = globalThis as unknown as ServerGlobalWithDom;
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
  const serverGlobal = globalThis as unknown as ServerGlobalWithDom;
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

async function ensureMermaidInitialized() {
  // Mermaid imports DOMPurify, whose default export binds to `window` during
  // module evaluation. Keep this import dynamic and run it only while the
  // standards-complete JSDOM globals are installed.
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

function createAbortError() {
  return new DOMException(
    "Mermaid syntax validation was aborted.",
    "AbortError",
  );
}

function createTimeoutError(timeoutMs: number) {
  return new DOMException(
    `Mermaid syntax validation timed out after ${timeoutMs}ms.`,
    "TimeoutError",
  );
}

function getAbortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : createAbortError();
}

function throwIfValidationStopped(signal: AbortSignal) {
  if (signal.aborted) {
    throw getAbortReason(signal);
  }
}

function getValidationTimeoutMs(timeoutMs?: number) {
  const value = timeoutMs ?? DEFAULT_VALIDATION_TIMEOUT_MS;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      "Mermaid validation timeoutMs must be greater than 0.",
    );
  }

  return value;
}

function createValidationDeadline(options: MermaidValidationOptions) {
  const timeoutMs = getValidationTimeoutMs(options.timeoutMs);
  const controller = new AbortController();
  const abortFromCaller = () => {
    controller.abort(
      options.signal ? getAbortReason(options.signal) : createAbortError(),
    );
  };

  if (options.signal?.aborted) {
    abortFromCaller();
  } else {
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeout = setTimeout(() => {
    controller.abort(createTimeoutError(timeoutMs));
  }, timeoutMs);

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

/**
 * Rejects the caller promptly when validation is cancelled while continuing to
 * observe the queued work. The underlying Mermaid parse cannot be interrupted,
 * so it must retain the serialized DOM slot until it settles and restores the
 * process globals.
 */
function waitForValidation<T>(work: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.reject<T>(getAbortReason(signal));
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(getAbortReason(signal));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);

    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
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
  options: MermaidValidationOptions = {},
): Promise<MermaidValidationResult> {
  const deadline = createValidationDeadline(options);

  try {
    throwIfValidationStopped(deadline.signal);

    const serverParseDiagram = buildServerParseDiagram(diagram);
    if (serverParseDiagram.issue) {
      return serverParseDiagram.issue;
    }

    const queuedValidation = serializeInProcessValidation(async () => {
      // A cancelled validation that has not acquired the global DOM slot does
      // not need to run. Once parsing starts, however, it must stay in this
      // queue until Mermaid settles so the globals cannot overlap another run.
      throwIfValidationStopped(deadline.signal);

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

    return await waitForValidation(queuedValidation, deadline.signal);
  } finally {
    deadline.dispose();
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
