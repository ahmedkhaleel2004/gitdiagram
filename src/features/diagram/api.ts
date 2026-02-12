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

const getGenerateBasePath = () => {
  const useLegacyBackend =
    process.env.NEXT_PUBLIC_USE_LEGACY_BACKEND?.trim() === "true";
  if (!useLegacyBackend) {
    return "/api/generate";
  }

  const legacyApiBase = process.env.NEXT_PUBLIC_API_DEV_URL?.trim();
  if (legacyApiBase) {
    return `${legacyApiBase.replace(/\/$/, "")}/generate`;
  }
  return "/api/generate";
};

export async function getGenerationCost(
  username: string,
  repo: string,
  githubPat?: string,
  apiKey?: string,
): Promise<DiagramCostResponse> {
  try {
    const response = await fetch(`${getGenerateBasePath()}/cost`, {
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
  const response = await fetch(`${getGenerateBasePath()}/stream`, {
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
    let streamBuffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      streamBuffer += new TextDecoder().decode(value);
      const { messages, remainder } = parseSSEStreamBuffer(streamBuffer);
      streamBuffer = remainder;
      for (const message of messages) {
        const shouldContinue = await handlers.onMessage(message);
        if (shouldContinue === false) {
          return;
        }
      }
    }

    const { messages } = parseSSEStreamBuffer(`${streamBuffer}\n\n`);
    for (const message of messages) {
      const shouldContinue = await handlers.onMessage(message);
      if (shouldContinue === false) {
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
