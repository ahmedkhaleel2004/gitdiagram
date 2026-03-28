import {
  getModel,
  getProvider,
  getProviderLabel,
  supportsExactInputTokenCount,
} from "~/server/generate/model-config";
import {
  extractComponentMapping,
  processClickEvents,
  stripMermaidCodeFences,
  toTaggedMessage,
} from "~/server/generate/format";
import { getGithubData } from "~/server/generate/github";
import {
  countInputTokens,
  estimateTokens,
  streamCompletion,
} from "~/server/generate/openai";
import {
  SYSTEM_FIRST_PROMPT,
  SYSTEM_SECOND_PROMPT,
  SYSTEM_THIRD_PROMPT,
} from "~/server/generate/prompts";
import { repairMermaidDiagram } from "~/server/generate/repair";
import { generateRequestSchema, sseMessage } from "~/server/generate/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function estimateRepoTokenCount(
  provider: ReturnType<typeof getProvider>,
  model: string,
  fileTree: string,
  readme: string,
  apiKey?: string,
) {
  if (!supportsExactInputTokenCount(provider)) {
    return estimateTokens(`${fileTree}\n${readme}`);
  }

  try {
    return await countInputTokens({
      provider,
      model,
      systemPrompt: SYSTEM_FIRST_PROMPT,
      userPrompt: toTaggedMessage({
        file_tree: fileTree,
        readme,
      }),
      apiKey,
      reasoningEffort: "medium",
    });
  } catch {
    return estimateTokens(`${fileTree}\n${readme}`);
  }
}

export async function POST(request: Request) {
  const parsed = generateRequestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Invalid request payload.",
        error_code: "VALIDATION_ERROR",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const {
    username,
    repo,
    api_key: apiKey,
    github_pat: githubPat,
  } = parsed.data;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseMessage(payload)));
      };

      const run = async () => {
        try {
          const githubData = await getGithubData(username, repo, githubPat);
          const provider = getProvider();
          const providerLabel = getProviderLabel(provider);
          const model = getModel(provider);
          const tokenCount = await estimateRepoTokenCount(
            provider,
            model,
            githubData.fileTree,
            githubData.readme,
            apiKey,
          );

          send({
            status: "started",
            message: "Starting generation process...",
          });

          if (tokenCount > 50000 && tokenCount < 195000 && !apiKey) {
            send({
                status: "error",
                error:
                  `File tree and README combined exceeds token limit (50,000). This repository is too large for free generation. Provide your own ${providerLabel} API key to continue.`,
                error_code: "API_KEY_REQUIRED",
              });
            controller.close();
            return;
          }

          if (tokenCount > 195000) {
            send({
              status: "error",
              error:
                "Repository is too large (>195k tokens) for analysis. Try a smaller repo.",
              error_code: "TOKEN_LIMIT_EXCEEDED",
            });
            controller.close();
            return;
          }

          send({
            status: "explanation_sent",
            message: `Sending explanation request to ${model}...`,
          });
          await sleep(80);
          send({
            status: "explanation",
            message: "Analyzing repository structure...",
          });

          let explanation = "";
          for await (const chunk of streamCompletion({
            provider,
            model,
            systemPrompt: SYSTEM_FIRST_PROMPT,
            userPrompt: toTaggedMessage({
              file_tree: githubData.fileTree,
              readme: githubData.readme,
            }),
            apiKey,
            reasoningEffort: "medium",
          })) {
            explanation += chunk;
            send({ status: "explanation_chunk", chunk });
          }

          send({
            status: "mapping_sent",
            message: `Sending component mapping request to ${model}...`,
          });
          await sleep(80);
          send({
            status: "mapping",
            message: "Creating component mapping...",
          });

          let fullMappingResponse = "";
          for await (const chunk of streamCompletion({
            provider,
            model,
            systemPrompt: SYSTEM_SECOND_PROMPT,
            userPrompt: toTaggedMessage({
              explanation,
              file_tree: githubData.fileTree,
            }),
            apiKey,
            reasoningEffort: "low",
          })) {
            fullMappingResponse += chunk;
            send({ status: "mapping_chunk", chunk });
          }

          const componentMapping = extractComponentMapping(fullMappingResponse);

          send({
            status: "diagram_sent",
            message: `Sending diagram generation request to ${model}...`,
          });
          await sleep(80);
          send({
            status: "diagram",
            message: "Generating diagram...",
          });

          let mermaidCode = "";
          for await (const chunk of streamCompletion({
            provider,
            model,
            systemPrompt: SYSTEM_THIRD_PROMPT,
            userPrompt: toTaggedMessage({
              explanation,
              component_mapping: componentMapping,
            }),
            apiKey,
            reasoningEffort: "low",
          })) {
            mermaidCode += chunk;
            send({ status: "diagram_chunk", chunk });
          }

          const repairResult = await repairMermaidDiagram({
            provider,
            model,
            apiKey,
            diagram: stripMermaidCodeFences(mermaidCode),
            explanation,
            componentMapping,
            onStatus: (payload) => send(payload),
          });

          if (!repairResult.ok) {
            send({
              status: "error",
              error: repairResult.error,
              error_code: "MERMAID_SYNTAX_UNRESOLVED",
              parser_error: repairResult.parserError,
            });
            return;
          }

          const processedDiagram = processClickEvents(
            repairResult.diagram,
            username,
            repo,
            githubData.defaultBranch,
          );

          if (repairResult.hadFixLoop) {
            send({
              status: "diagram_fixing",
              message: "Mermaid syntax validated. Finalizing diagram output...",
            });
          }

          send({
            status: "complete",
            diagram: processedDiagram,
            explanation,
            mapping: componentMapping,
          });
        } catch (error) {
          send({
            status: "error",
            error:
              error instanceof Error
                ? error.message
                : "Streaming generation failed.",
            error_code: "STREAM_FAILED",
          });
        } finally {
          controller.close();
        }
      };

      void run();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
