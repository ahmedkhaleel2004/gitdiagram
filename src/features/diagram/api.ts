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

export async function getDiagramState(
  username: string,
  repo: string,
  githubPat?: string,
): Promise<DiagramStateResponse> {
  const response = await fetch("/api/diagram-state", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username,
      repo,
      github_pat: githubPat,
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
      body: JSON.stringify({
        username: params.username,
        repo: params.repo,
        api_key: params.apiKey,
        github_pat: params.githubPat,
        session_id: sessionId,
        cancel_token: cancelToken,
      }),
      signal: params.signal,
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error(
          "Too many generation requests. Please wait and try again.",
        );
      }

      try {
        const data = (await response.json()) as DiagramStreamMessage;
        throw new Error(data.error ?? "Failed to start streaming");
      } catch (error) {
        if (error instanceof Error) {
          throw error;
        }
        throw new Error("Failed to start streaming");
      }
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
