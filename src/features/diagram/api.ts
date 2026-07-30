import { migrateLegacyCredentialStorage } from "~/features/credentials/api";
import { parseSSEStreamBuffer } from "~/features/diagram/sse";
import type {
  DiagramStateResponse,
  DiagramStreamMessage,
  StreamGenerationParams,
} from "~/features/diagram/types";

interface StreamHandlers {
  onMessage: (
    message: DiagramStreamMessage,
  ) => boolean | void | Promise<boolean | void>;
}

const GENERATE_BASE_PATH = "/api/generate";

/**
 * A generation request rejected before any SSE stream started (rate limit,
 * validation, session conflict, outage). Carries the server's own explanation
 * so consumers can surface it verbatim, plus the HTTP status and error code
 * for robust handling (e.g. offering the API-key CTA on a 429).
 */
export class DiagramStreamHttpError extends Error {
  readonly status: number;
  readonly errorCode?: string;

  constructor(message: string, status: number, errorCode?: string) {
    super(message);
    this.name = "DiagramStreamHttpError";
    this.status = status;
    this.errorCode = errorCode;
  }
}

export async function getDiagramState(
  username: string,
  repo: string,
): Promise<DiagramStateResponse> {
  await migrateLegacyCredentialStorage();

  const response = await fetch("/api/diagram-state", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "same-origin",
    body: JSON.stringify({
      username,
      repo,
    }),
  });

  if (!response.ok) {
    throw new Error("Diagram state is temporarily unavailable.");
  }

  return (await response.json()) as DiagramStateResponse;
}

function isTerminalMessage(message: DiagramStreamMessage): boolean {
  return (
    message.status === "complete" ||
    message.status === "error" ||
    Boolean(message.error)
  );
}

function sendGenerationCancellation(
  sessionId: string,
  cancelToken: string,
): void {
  void fetch(`${GENERATE_BASE_PATH}/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "omit",
    body: JSON.stringify({
      session_id: sessionId,
      cancel_token: cancelToken,
    }),
    keepalive: true,
  }).catch(() => {
    // The stream's own deadline remains the fallback if this best-effort
    // cancellation notification cannot reach the server.
  });
}

export async function streamDiagramGeneration(
  params: StreamGenerationParams,
  handlers: StreamHandlers,
): Promise<void> {
  await migrateLegacyCredentialStorage();

  const sessionId = globalThis.crypto.randomUUID();
  const cancelToken = globalThis.crypto.randomUUID();
  let receivedTerminalEvent = false;
  let cancellationSent = false;
  const notifyCancellation = () => {
    if (receivedTerminalEvent || cancellationSent) {
      return;
    }
    cancellationSent = true;
    sendGenerationCancellation(sessionId, cancelToken);
  };

  params.signal?.addEventListener("abort", notifyCancellation, { once: true });
  if (params.signal?.aborted) {
    notifyCancellation();
  }

  try {
    const response = await fetch(`${GENERATE_BASE_PATH}/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({
        username: params.username,
        repo: params.repo,
        session_id: sessionId,
        cancel_token: cancelToken,
      }),
      signal: params.signal,
    });

    if (!response.ok) {
      // Our own admission errors are JSON explaining exactly what went wrong
      // (a 429 says how long the wait is); the platform WAF returns HTML, so
      // fall back to a generic message when no error body can be parsed.
      const body = await response
        .json()
        .then((data) => data as DiagramStreamMessage)
        .catch(() => undefined);
      throw new DiagramStreamHttpError(
        body?.error ??
          (response.status === 429
            ? "Too many generation requests. Please wait and try again."
            : "Failed to start streaming"),
        response.status,
        body?.error_code,
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No reader available");
    }

    try {
      let streamBuffer = "";
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamBuffer += decoder.decode(value, { stream: true });
        const { messages, remainder } = parseSSEStreamBuffer(streamBuffer);
        streamBuffer = remainder;
        for (const message of messages) {
          receivedTerminalEvent =
            receivedTerminalEvent || isTerminalMessage(message);
          const shouldContinue = await handlers.onMessage(message);
          if (shouldContinue === false) {
            if (!receivedTerminalEvent) {
              notifyCancellation();
            }
            await reader.cancel();
            return;
          }
        }
      }

      streamBuffer += decoder.decode();
      const { messages } = parseSSEStreamBuffer(`${streamBuffer}\n\n`);
      for (const message of messages) {
        receivedTerminalEvent =
          receivedTerminalEvent || isTerminalMessage(message);
        const shouldContinue = await handlers.onMessage(message);
        if (shouldContinue === false) {
          if (!receivedTerminalEvent) {
            notifyCancellation();
          }
          await reader.cancel();
          return;
        }
      }

      if (!receivedTerminalEvent) {
        throw new Error(
          "Generation stream ended before completion. Please retry.",
        );
      }
    } finally {
      reader.releaseLock();
    }
  } finally {
    if (!receivedTerminalEvent) {
      notifyCancellation();
    }
    params.signal?.removeEventListener("abort", notifyCancellation);
  }
}
