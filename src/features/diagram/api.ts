import { parseSSEChunk } from "~/features/diagram/sse";
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

const getApiBaseUrl = () =>
  process.env.NEXT_PUBLIC_API_DEV_URL ?? "https://api.gitdiagram.com";

export async function getGenerationCost(
  username: string,
  repo: string,
  githubPat?: string,
): Promise<DiagramCostResponse> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/generate/cost`, {
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

    if (response.status === 429) {
      return { error: "Rate limit exceeded. Please try again later." };
    }

    const data = (await response.json()) as DiagramCostResponse;
    return {
      cost: data.cost,
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
  const response = await fetch(`${getApiBaseUrl()}/generate/stream`, {
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
  });

  if (!response.ok) {
    throw new Error("Failed to start streaming");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No reader available");
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = new TextDecoder().decode(value);
      const messages = parseSSEChunk(chunk);
      for (const message of messages) {
        const shouldContinue = await handlers.onMessage(message);
        if (shouldContinue === false) {
          return;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
