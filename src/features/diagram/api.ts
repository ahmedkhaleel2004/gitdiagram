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

type GenerationBackendMode = "next" | "fastapi";

function getGenerationBackendMode(): GenerationBackendMode {
  const mode = process.env.NEXT_PUBLIC_GENERATION_BACKEND?.trim().toLowerCase();

  if (mode === "next" || mode === "fastapi") {
    return mode;
  }

  throw new Error(
    "Missing NEXT_PUBLIC_GENERATION_BACKEND. Set it to 'next' or 'fastapi'.",
  );
}

function getGenerateBasePath() {
  const mode = getGenerationBackendMode();

  if (mode === "next") {
    return "/api/generate";
  }

  const apiBaseUrl = process.env.NEXT_PUBLIC_GENERATE_API_BASE_URL?.trim();
  if (!apiBaseUrl) {
    throw new Error(
      "Missing NEXT_PUBLIC_GENERATE_API_BASE_URL for fastapi generation mode.",
    );
  }

  return apiBaseUrl.replace(/\/$/, "");
}

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
