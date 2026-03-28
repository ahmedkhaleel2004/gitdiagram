import {
  formatValidationFeedback,
  validateMermaidSyntax,
} from "~/server/generate/mermaid";
import { streamCompletion } from "~/server/generate/openai";
import { SYSTEM_FIX_MERMAID_PROMPT } from "~/server/generate/prompts";
import type { AIProvider } from "~/server/generate/model-config";
import { stripMermaidCodeFences, toTaggedMessage } from "~/server/generate/format";

const MAX_MERMAID_FIX_ATTEMPTS = 3;

interface RepairStatusPayload extends Record<string, unknown> {
  status:
    | "diagram_fixing"
    | "diagram_fix_attempt"
    | "diagram_fix_chunk"
    | "diagram_fix_validating";
  message?: string;
  chunk?: string;
  parser_error?: string;
  fix_attempt?: number;
  fix_max_attempts?: number;
}

interface RepairMermaidDiagramParams {
  provider: AIProvider;
  model: string;
  apiKey?: string;
  diagram: string;
  explanation: string;
  componentMapping: string;
  initialFeedback?: string;
  onStatus?: (payload: RepairStatusPayload) => void | Promise<void>;
}

type RepairMermaidDiagramResult =
  | {
      ok: true;
      diagram: string;
      hadFixLoop: boolean;
    }
  | {
      ok: false;
      error: string;
      parserError: string;
      hadFixLoop: boolean;
    };

export async function repairMermaidDiagram({
  provider,
  model,
  apiKey,
  diagram,
  explanation,
  componentMapping,
  initialFeedback,
  onStatus,
}: RepairMermaidDiagramParams): Promise<RepairMermaidDiagramResult> {
  let candidateDiagram = stripMermaidCodeFences(diagram);
  let validationResult = await validateMermaidSyntax(candidateDiagram);
  let parserFeedback = validationResult.valid
    ? initialFeedback?.trim() || "Browser Mermaid render failed."
    : formatValidationFeedback(validationResult);
  let needsRepair = !validationResult.valid || Boolean(initialFeedback?.trim());
  const hadFixLoop = needsRepair;

  if (needsRepair) {
    await onStatus?.({
      status: "diagram_fixing",
      message: validationResult.valid
        ? "Browser render failed. Starting Mermaid auto-fix loop..."
        : "Diagram generated. Mermaid syntax validation failed, starting auto-fix loop...",
      parser_error: parserFeedback,
    });
  }

  for (let attempt = 1; needsRepair && attempt <= MAX_MERMAID_FIX_ATTEMPTS; attempt++) {
    await onStatus?.({
      status: "diagram_fix_attempt",
      message: `Fixing Mermaid syntax (attempt ${attempt}/${MAX_MERMAID_FIX_ATTEMPTS})...`,
      fix_attempt: attempt,
      fix_max_attempts: MAX_MERMAID_FIX_ATTEMPTS,
      parser_error: parserFeedback,
    });

    let repairedDiagram = "";
    for await (const chunk of streamCompletion({
      provider,
      model,
      systemPrompt: SYSTEM_FIX_MERMAID_PROMPT,
      userPrompt: toTaggedMessage({
        mermaid_code: candidateDiagram,
        parser_error: parserFeedback,
        explanation,
        component_mapping: componentMapping,
      }),
      apiKey,
      reasoningEffort: "low",
    })) {
      repairedDiagram += chunk;
      await onStatus?.({
        status: "diagram_fix_chunk",
        chunk,
        fix_attempt: attempt,
        fix_max_attempts: MAX_MERMAID_FIX_ATTEMPTS,
      });
    }

    candidateDiagram = stripMermaidCodeFences(repairedDiagram);
    await onStatus?.({
      status: "diagram_fix_validating",
      message: `Validating Mermaid syntax after attempt ${attempt}/${MAX_MERMAID_FIX_ATTEMPTS}...`,
      fix_attempt: attempt,
      fix_max_attempts: MAX_MERMAID_FIX_ATTEMPTS,
    });

    validationResult = await validateMermaidSyntax(candidateDiagram);
    needsRepair = !validationResult.valid;
    if (!needsRepair) {
      return {
        ok: true,
        diagram: candidateDiagram,
        hadFixLoop,
      };
    }

    parserFeedback = formatValidationFeedback(validationResult);
  }

  return {
    ok: false,
    error:
      "Generated Mermaid remained syntactically invalid after auto-fix attempts. Please retry generation.",
    parserError: parserFeedback,
    hadFixLoop,
  };
}
