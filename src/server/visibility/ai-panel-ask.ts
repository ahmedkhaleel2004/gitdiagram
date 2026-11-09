import "server-only";

import type { PanelEngine } from "~/features/admin/ai-panel";
import { aiVisibilityModels, askAssistant, type AskResult } from "./ai-ask";

// One panel question to one engine, always with web search: ChatGPT and
// Claude through their own APIs (the daily run's code), Gemini (Google Search
// grounding) and Perplexity (Sonar, which always searches) through
// OpenRouter, the key the site already has for narration.

const OPENROUTER = "https://openrouter.ai/api/v1";
const MAX_OUTPUT_TOKENS = 1_800;
const SEARCH_NUDGE =
  "Search the web to check what is current before you answer.";

export function panelModels(): Record<PanelEngine, string> {
  const daily = aiVisibilityModels();
  return {
    chatgpt: daily.openai,
    claude: daily.anthropic,
    gemini:
      process.env.AI_PANEL_GEMINI_MODEL?.trim() || "google/gemini-3.8-flash",
    perplexity:
      process.env.AI_PANEL_PERPLEXITY_MODEL?.trim() || "perplexity/sonar",
  };
}

export function panelEngineConfigured(engine: PanelEngine): boolean {
  const key =
    engine === "chatgpt"
      ? process.env.OPENAI_API_KEY
      : engine === "claude"
        ? process.env.ANTHROPIC_API_KEY
        : process.env.OPENROUTER_API_KEY;
  return Boolean(key?.trim());
}

/** Whether an engine is paid from the OpenRouter balance narration uses. */
export function usesOpenRouter(engine: PanelEngine): boolean {
  return engine === "gemini" || engine === "perplexity";
}

interface OpenRouterAnnotation {
  type?: string;
  url_citation?: { url?: string; title?: string };
}

interface OpenRouterResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null; annotations?: OpenRouterAnnotation[] };
  }>;
  usage?: { cost?: number };
  error?: { message?: string };
}

/**
 * Gemini cites Google's grounding redirects
 * (vertexaisearch.cloud.google.com/grounding-api-redirect/...). The page they
 * lead to is read from the redirect; when that fails, the site's name
 * (the citation's title) stands in.
 */
async function resolveGrounding(
  url: string,
  title: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  if (!/^https:\/\/vertexaisearch\.cloud\.google\.com\//.test(url)) return url;
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
    });
    void response.body?.cancel();
    const location = response.headers.get("location");
    if (location && /^https?:\/\//.test(location)) return location;
  } catch {
    // Fall through to the title.
  }
  return title && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(title)
    ? `https://${title.toLowerCase()}/`
    : url;
}

/** The numbers of the `[n]` markers in a Perplexity answer. */
export function citedIndexes(text: string): Set<number> {
  const found = new Set<number>();
  for (const match of text.matchAll(/\[(\d{1,2})\]/g))
    found.add(Number(match[1]));
  return found;
}

async function askOpenRouter(
  engine: "gemini" | "perplexity",
  model: string,
  prompt: string,
  signal: AbortSignal,
): Promise<AskResult> {
  const response = await fetch(`${OPENROUTER}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENROUTER_API_KEY?.trim() ?? ""}`,
      "content-type": "application/json",
      "x-title": "GitDiagram AI visibility panel",
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      usage: { include: true },
      messages:
        engine === "gemini"
          ? [
              { role: "system", content: SEARCH_NUDGE },
              { role: "user", content: prompt },
            ]
          : [{ role: "user", content: prompt }],
      ...(engine === "gemini"
        ? {
            reasoning: { effort: "low" },
            // Google's own search grounding, as in the Gemini app.
            plugins: [{ id: "web", engine: "native" }],
          }
        : {}),
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
  });
  const body = (await response
    .json()
    .catch(() => null)) as OpenRouterResponse | null;
  if (!response.ok || !body?.choices?.[0])
    throw new Error(
      `OpenRouter ${response.status}: ${body?.error?.message ?? "no answer"}`.slice(
        0,
        160,
      ),
    );
  const choice = body.choices[0];
  const text = choice.message?.content ?? "";
  const notes = (choice.message?.annotations ?? []).filter(
    (note) => note.type === "url_citation" && note.url_citation?.url,
  );
  const urls = await Promise.all(
    notes.map((note) =>
      resolveGrounding(
        note.url_citation!.url!,
        note.url_citation!.title,
        signal,
      ),
    ),
  );
  // Perplexity returns every search result; the answer cites some by [n].
  const marked = engine === "perplexity" ? citedIndexes(text) : null;
  const citations = marked
    ? urls.filter((_, index) => marked.has(index + 1))
    : urls;
  return {
    model,
    text,
    citations,
    sources: urls,
    costUsd: typeof body.usage?.cost === "number" ? body.usage.cost : 0,
    truncated: choice.finish_reason === "length",
  };
}

export function askPanelEngine(
  engine: PanelEngine,
  prompt: string,
  signal: AbortSignal,
): Promise<AskResult> {
  if (engine === "chatgpt")
    return askAssistant("openai", prompt, "search", signal);
  if (engine === "claude")
    return askAssistant("anthropic", prompt, "search", signal);
  return askOpenRouter(engine, panelModels()[engine], prompt, signal);
}

/** The OpenRouter balance left in USD; null when unreadable. */
export async function openRouterBalanceUsd(): Promise<number | null> {
  try {
    const response = await fetch(`${OPENROUTER}/credits`, {
      headers: {
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY?.trim() ?? ""}`,
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      data?: { total_credits?: number; total_usage?: number };
    };
    const { total_credits: credits, total_usage: usage } = body.data ?? {};
    return typeof credits === "number" && typeof usage === "number"
      ? credits - usage
      : null;
  } catch {
    return null;
  }
}
