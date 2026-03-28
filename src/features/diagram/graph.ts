import { z } from "zod";

export const MAX_GRAPH_GROUPS = 10;
export const MAX_GRAPH_NODES = 34;
export const MAX_GRAPH_EDGES = 48;
export const MAX_GRAPH_LABEL_LENGTH = 72;
export const MAX_GRAPH_TYPE_LENGTH = 72;
export const MAX_GRAPH_DESCRIPTION_LENGTH = 240;
export const MAX_GRAPH_PATH_LENGTH = 512;
export const MAX_GRAPH_ATTEMPTS = 3;

export const diagramNodeShapeSchema = z.enum([
  "box",
  "database",
  "queue",
  "document",
  "circle",
  "hexagon",
]);

export const diagramEdgeStyleSchema = z.enum(["solid", "dashed"]);

export const diagramGroupSchema = z.object({
  id: z.string().trim().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(MAX_GRAPH_LABEL_LENGTH),
  description: z
    .string()
    .trim()
    .max(MAX_GRAPH_DESCRIPTION_LENGTH)
    .nullable(),
});

export const diagramNodeSchema = z.object({
  id: z.string().trim().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(MAX_GRAPH_LABEL_LENGTH),
  type: z.string().trim().min(1).max(MAX_GRAPH_TYPE_LENGTH),
  description: z
    .string()
    .trim()
    .max(MAX_GRAPH_DESCRIPTION_LENGTH)
    .nullable(),
  groupId: z.string().trim().regex(/^[a-z][a-z0-9_]*$/).nullable(),
  path: z.string().trim().min(1).max(MAX_GRAPH_PATH_LENGTH).nullable(),
  shape: diagramNodeShapeSchema.nullable(),
});

export const diagramEdgeSchema = z.object({
  from: z.string().trim().regex(/^[a-z][a-z0-9_]*$/),
  to: z.string().trim().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(MAX_GRAPH_LABEL_LENGTH).nullable(),
  description: z
    .string()
    .trim()
    .max(MAX_GRAPH_DESCRIPTION_LENGTH)
    .nullable(),
  style: diagramEdgeStyleSchema.nullable(),
});

export const diagramGraphSchema = z.object({
  groups: z.array(diagramGroupSchema).max(MAX_GRAPH_GROUPS),
  nodes: z.array(diagramNodeSchema).min(1).max(MAX_GRAPH_NODES),
  edges: z.array(diagramEdgeSchema).max(MAX_GRAPH_EDGES),
});

export type DiagramNodeShape = z.infer<typeof diagramNodeShapeSchema>;
export type DiagramEdgeStyle = z.infer<typeof diagramEdgeStyleSchema>;
export type DiagramGraphGroup = z.infer<typeof diagramGroupSchema>;
export type DiagramGraphNode = z.infer<typeof diagramNodeSchema>;
export type DiagramGraphEdge = z.infer<typeof diagramEdgeSchema>;
export type DiagramGraph = z.infer<typeof diagramGraphSchema>;

export interface GraphAttemptAudit {
  attempt: number;
  rawOutput: string;
  graph: DiagramGraph | null;
  validationFeedback?: string;
  status: "failed" | "succeeded";
  createdAt: string;
}

export interface GenerationTimelineEvent {
  stage: string;
  message?: string;
  createdAt: string;
}

export type DiagramSessionStatus = "idle" | "running" | "succeeded" | "failed";

export interface GenerationSessionAudit {
  sessionId: string;
  status: DiagramSessionStatus;
  stage: string;
  provider: string;
  model: string;
  explanation?: string;
  graph: DiagramGraph | null;
  graphAttempts: GraphAttemptAudit[];
  compiledDiagram?: string;
  validationError?: string;
  failureStage?: string;
  compilerError?: string;
  renderError?: string;
  timeline: GenerationTimelineEvent[];
  createdAt: string;
  updatedAt: string;
}
