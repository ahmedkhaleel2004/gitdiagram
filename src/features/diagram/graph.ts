import { z } from "zod";
import type {
  GenerationCostSummary,
  GenerationStageUsage,
} from "~/features/diagram/cost";

const MAX_GRAPH_GROUPS = 10;
const MAX_GRAPH_NODES = 34;
const MAX_GRAPH_EDGES = 48;
const MAX_GRAPH_LABEL_LENGTH = 72;
const MAX_GRAPH_TYPE_LENGTH = 72;
const MAX_GRAPH_DESCRIPTION_LENGTH = 240;
const MAX_GRAPH_PATH_LENGTH = 512;
export const MAX_GRAPH_ATTEMPTS = 3;

export function normalizeDiagramText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function renderableDiagramTextSchema(maxLength: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .refine((value) => normalizeDiagramText(value).length > 0, {
      message: "Must contain visible text.",
    });
}

const diagramNodeShapeSchema = z.enum([
  "box",
  "database",
  "queue",
  "document",
  "circle",
  "hexagon",
]);

const diagramEdgeStyleSchema = z.enum(["solid", "dashed"]);

const diagramGroupSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]*$/),
  label: renderableDiagramTextSchema(MAX_GRAPH_LABEL_LENGTH),
  description: z.string().trim().max(MAX_GRAPH_DESCRIPTION_LENGTH).nullable(),
});

const diagramNodeSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]*$/),
  label: renderableDiagramTextSchema(MAX_GRAPH_LABEL_LENGTH),
  type: renderableDiagramTextSchema(MAX_GRAPH_TYPE_LENGTH),
  description: z.string().trim().max(MAX_GRAPH_DESCRIPTION_LENGTH).nullable(),
  groupId: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]*$/)
    .nullable(),
  path: z.string().trim().min(1).max(MAX_GRAPH_PATH_LENGTH).nullable(),
  shape: diagramNodeShapeSchema.nullable(),
});

const diagramEdgeSchema = z.object({
  from: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]*$/),
  to: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]*$/),
  label: renderableDiagramTextSchema(MAX_GRAPH_LABEL_LENGTH).nullable(),
  description: z.string().trim().max(MAX_GRAPH_DESCRIPTION_LENGTH).nullable(),
  style: diagramEdgeStyleSchema.nullable(),
});

export const diagramGraphSchema = z.object({
  groups: z.array(diagramGroupSchema).max(MAX_GRAPH_GROUPS),
  nodes: z.array(diagramNodeSchema).min(1).max(MAX_GRAPH_NODES),
  edges: z.array(diagramEdgeSchema).max(MAX_GRAPH_EDGES),
});

export type DiagramGraphNode = z.infer<typeof diagramNodeSchema>;
export type DiagramGraphEdge = z.infer<typeof diagramEdgeSchema>;
export type DiagramGraph = z.infer<typeof diagramGraphSchema>;

export interface GraphAttemptAudit {
  attempt: number;
  rawOutput: string;
  graph: DiagramGraph | null;
  validationFeedback?: string;
  validationCategories?: string[];
  /** Node paths dropped because they did not resolve in the repository tree. */
  strippedPathCount?: number;
  status: "failed" | "succeeded";
  createdAt: string;
}

interface GenerationTimelineEvent {
  stage: string;
  message?: string;
  createdAt: string;
}

type DiagramSessionStatus = "idle" | "running" | "succeeded" | "failed";

export interface GenerationSessionAudit {
  sessionId: string;
  status: DiagramSessionStatus;
  stage: string;
  provider: string;
  model: string;
  quotaStatus?: "admitted" | "denied" | "finalized";
  quotaBucket?: string;
  quotaDateUtc?: string;
  actualCommittedTokens?: number;
  quotaResetAt?: string;
  estimatedCost?: GenerationCostSummary;
  finalCost?: GenerationCostSummary;
  explanation?: string;
  graph: DiagramGraph | null;
  graphAttempts: GraphAttemptAudit[];
  stageUsages: GenerationStageUsage[];
  compiledDiagram?: string;
  validationError?: string;
  failureStage?: string;
  compilerError?: string;
  renderError?: string;
  timeline: GenerationTimelineEvent[];
  createdAt: string;
  updatedAt: string;
}
