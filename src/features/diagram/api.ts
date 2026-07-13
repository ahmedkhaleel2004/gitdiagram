import { parseSSEStreamBuffer } from "~/features/diagram/sse";
import type {
  DiagramCostResponse,
  DiagramStreamMessage,
  StreamGenerationParams,
} from "~/features/diagram/types";

interface StreamHandlers {
  onMessage: (
    message: DiagramStreamMessage,
  ) => boolean | void | Promise<boolean | void>;
}

const GENERATE_BASE_PATH = "/api/generate";

export async function getGenerationCost(
  username: string,
  repo: string,
  githubPat?: string,
  apiKey?: string,
): Promise<DiagramCostResponse> {
  try {
    const response = await fetch(`${GENERATE_BASE_PATH}/cost`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username,
        repo,
        api_key: apiKey,
        github_pat: githubPat,
      }),
    });

    if (response.status === 429) {
      return { error: "Rate limit exceeded. Please try again later." };
    }

    if (!response.ok) {
      try {
        const data = (await response.json()) as DiagramCostResponse;
        return {
          error: data.error ?? "Failed to get cost estimate.",
          error_code: data.error_code,
          ok: data.ok,
        };
      } catch {
        return { error: "Failed to get cost estimate." };
      }
    }

    const data = (await response.json()) as DiagramCostResponse;
    return {
      cost: data.cost,
      cost_summary: data.cost_summary,
      error: data.error,
      error_code: data.error_code,
      ok: data.ok,
    };
  } catch {
    return { error: "Failed to get cost estimate." };
  }
}

export async function streamDiagramGeneration(
  params: StreamGenerationParams,
  handlers: StreamHandlers,
): Promise<void> {
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
    let receivedTerminalEvent = false;
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      streamBuffer += decoder.decode(value, { stream: true });
      const { messages, remainder } = parseSSEStreamBuffer(streamBuffer);
      streamBuffer = remainder;
      for (const message of messages) {
        receivedTerminalEvent =
          receivedTerminalEvent ||
          message.status === "complete" ||
          message.status === "error" ||
          Boolean(message.error);
        const shouldContinue = await handlers.onMessage(message);
        if (shouldContinue === false) {
          await reader.cancel();
          return;
        }
      }
    }

    streamBuffer += decoder.decode();
    const { messages } = parseSSEStreamBuffer(`${streamBuffer}\n\n`);
    for (const message of messages) {
      receivedTerminalEvent =
        receivedTerminalEvent ||
        message.status === "complete" ||
        message.status === "error" ||
        Boolean(message.error);
      const shouldContinue = await handlers.onMessage(message);
      if (shouldContinue === false) {
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
}
