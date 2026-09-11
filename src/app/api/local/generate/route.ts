import { randomUUID } from "node:crypto";
import type { DiagramStreamMessage } from "~/features/diagram/types";
import {
  extractTaggedSection,
  toTaggedMessage,
} from "~/server/generate/format";
import {
  buildFileTreeLookup,
  compileDiagramGraph,
  formatGraphValidationFeedback,
  parseDiagramGraph,
  repairDiagramGraph,
  stripUnknownNodePaths,
  validateDiagramGraph,
} from "~/server/generate/graph";
import { getLocalData } from "~/server/generate/local";
import { runCliCompletion } from "~/server/generate/cli";
import {
  SYSTEM_FIRST_PROMPT,
  SYSTEM_GRAPH_PROMPT,
} from "~/server/generate/prompts";
import { sseMessage } from "~/server/generate/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractJson(text: string): string {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  return start >= 0 && end > start ? clean.slice(start, end + 1) : clean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedId(
  value: unknown,
  fallback: string,
  used: Set<string>,
): string {
  const raw = typeof value === "string" ? value : fallback;
  const base =
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "") || fallback;
  let candidate = /^[a-z]/.test(base) ? base : `id_${base}`;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}_${suffix++}`;
  used.add(candidate);
  return candidate;
}

function normalizeCliGraph(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const groups = new Map<string, string>();
  const nodes = new Map<string, string>();
  const groupIds = new Set<string>();
  const nodeIds = new Set<string>();
  if (Array.isArray(value.groups))
    for (const [index, group] of value.groups.entries()) {
      if (!isRecord(group)) continue;
      const original = typeof group.id === "string" ? group.id : undefined;
      group.id = normalizedId(group.id, `group_${index + 1}`, groupIds);
      if (original) groups.set(original, group.id as string);
      group.description ??= null;
    }
  if (Array.isArray(value.nodes))
    for (const [index, node] of value.nodes.entries()) {
      if (!isRecord(node)) continue;
      const original = typeof node.id === "string" ? node.id : undefined;
      node.id = normalizedId(node.id, `node_${index + 1}`, nodeIds);
      if (original) nodes.set(original, node.id as string);
      node.description ??= null;
      node.groupId ??= null;
      node.path ??= null;
      node.shape ??= null;
      if (typeof node.groupId === "string")
        node.groupId = groups.get(node.groupId) ?? node.groupId;
      if (
        ![
          "box",
          "database",
          "queue",
          "document",
          "circle",
          "hexagon",
          null,
        ].includes(node.shape as string | null)
      )
        node.shape = null;
    }
  if (Array.isArray(value.edges))
    for (const edge of value.edges) {
      if (!isRecord(edge)) continue;
      edge.from ??= edge.source ?? edge.sourceId ?? edge.source_id;
      edge.to ??= edge.target ?? edge.targetId ?? edge.target_id;
      if (typeof edge.from === "string")
        edge.from = nodes.get(edge.from) ?? edge.from;
      if (typeof edge.to === "string") edge.to = nodes.get(edge.to) ?? edge.to;
      edge.label ??= null;
      edge.description ??= null;
      if (edge.style !== "solid" && edge.style !== "dashed") edge.style = null;
    }
  return value;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    local_path?: unknown;
    repo?: unknown;
  } | null;
  const localPath =
    typeof body?.local_path === "string" ? body.local_path.trim() : "";
  const repo =
    typeof body?.repo === "string" && body.repo.trim()
      ? body.repo.trim()
      : "local";
  if (!localPath || localPath.length > 4096)
    return Response.json(
      { error: "A local_path is required.", error_code: "VALIDATION_ERROR" },
      { status: 400 },
    );

  const sessionId = randomUUID();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: DiagramStreamMessage) =>
        controller.enqueue(encoder.encode(sseMessage(payload)));
      try {
        send({
          status: "started",
          session_id: sessionId,
          message: "Reading local repository files...",
        });
        const data = await getLocalData(localPath);
        send({
          status: "explanation_sent",
          session_id: sessionId,
          message: "Sending explanation request to the local CLI...",
        });
        const explanationResponse = await runCliCompletion({
          systemPrompt: SYSTEM_FIRST_PROMPT,
          userPrompt: toTaggedMessage({
            file_tree: data.fileTree,
            readme: data.readme,
          }),
          signal: request.signal,
        });
        const explanation = extractTaggedSection(
          explanationResponse.text,
          "explanation",
        );
        if (!explanation)
          throw new Error("The local CLI returned no usable explanation.");
        send({
          status: "explanation_chunk",
          session_id: sessionId,
          chunk: explanation,
        });
        const lookup = buildFileTreeLookup(data.fileTree);
        let feedback: string | undefined;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          send({
            status: "graph_sent",
            session_id: sessionId,
            message: "Planning local repository graph...",
          });
          const graphResponse = await runCliCompletion({
            systemPrompt: `${SYSTEM_GRAPH_PROMPT}\n\nReturn only a JSON object; do not use Markdown fences.`,
            userPrompt: toTaggedMessage({
              explanation,
              file_tree: data.fileTree,
              repo_owner: "local",
              repo_name: repo,
              validation_feedback: feedback,
            }),
            signal: request.signal,
          });
          const parsed = parseDiagramGraph(
            JSON.stringify(
              normalizeCliGraph(
                JSON.parse(extractJson(graphResponse.text)) as unknown,
              ),
            ),
          );
          if (parsed.graph) {
            const graph = stripUnknownNodePaths(
              repairDiagramGraph(parsed.graph, lookup),
              lookup,
            ).graph;
            const validation = validateDiagramGraph(graph, lookup);
            if (validation.valid) {
              const diagram = compileDiagramGraph({
                graph,
                username: "local",
                repo,
                branch: "local",
                pathTypes: data.pathTypes,
                includeGitHubLinks: false,
              });
              send({
                status: "complete",
                session_id: sessionId,
                explanation,
                graph,
                diagram,
                generated_at: new Date().toISOString(),
              });
              return;
            }
            feedback = formatGraphValidationFeedback(validation.issues);
          } else feedback = formatGraphValidationFeedback(parsed.issues);
          send({
            status: "graph_retry",
            session_id: sessionId,
            message: "Repairing local graph...",
            validation_error: feedback,
          });
        }
        throw new Error(
          "The local CLI could not produce a valid graph after three attempts.",
        );
      } catch (error) {
        send({
          status: "error",
          session_id: sessionId,
          error:
            error instanceof Error ? error.message : "Local generation failed.",
          error_code: "LOCAL_GENERATION_FAILED",
        });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
