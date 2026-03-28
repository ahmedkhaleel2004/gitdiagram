import { getModel, getProvider } from "~/server/generate/model-config";
import { processClickEvents } from "~/server/generate/format";
import { repairMermaidDiagram } from "~/server/generate/repair";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const repairRequestSchema = z.object({
  username: z.string().min(1),
  repo: z.string().min(1),
  diagram: z.string().min(1),
  explanation: z.string(),
  mapping: z.string(),
  parser_error: z.string().min(1),
  api_key: z.string().min(1).optional(),
  default_branch: z.string().min(1).default("main"),
});

export async function POST(request: Request) {
  const parsed = repairRequestSchema.safeParse(await request.json());

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
    diagram,
    explanation,
    mapping,
    parser_error: parserError,
    api_key: apiKey,
    default_branch: defaultBranch,
  } = parsed.data;

  try {
    const provider = getProvider();
    const model = getModel(provider);
    const repairResult = await repairMermaidDiagram({
      provider,
      model,
      apiKey,
      diagram,
      explanation,
      componentMapping: mapping,
      initialFeedback: parserError,
    });

    if (!repairResult.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: repairResult.error,
          error_code: "MERMAID_REPAIR_FAILED",
          parser_error: repairResult.parserError,
        }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        diagram: processClickEvents(
          repairResult.diagram,
          username,
          repo,
          defaultBranch,
        ),
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        error:
          error instanceof Error ? error.message : "Mermaid repair failed.",
        error_code: "MERMAID_REPAIR_FAILED",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
