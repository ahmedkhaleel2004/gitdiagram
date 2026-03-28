import type {
  DiagramGraph,
  GenerationSessionAudit,
  GraphAttemptAudit,
} from "~/features/diagram/graph";

export type DiagramStreamStatus =
  | "idle"
  | "started"
  | "explanation_sent"
  | "explanation"
  | "explanation_chunk"
  | "graph_sent"
  | "graph"
  | "graph_retry"
  | "graph_validating"
  | "diagram_compiling"
  | "complete"
  | "error";

export interface DiagramStreamState {
  status: DiagramStreamStatus;
  sessionId?: string;
  message?: string;
  explanation?: string;
  diagram?: string;
  graph?: DiagramGraph;
  graphAttempts?: GraphAttemptAudit[];
  error?: string;
  errorCode?: string;
  validationError?: string;
  failureStage?: string;
  latestSessionAudit?: GenerationSessionAudit;
}

export interface DiagramStreamMessage {
  status: DiagramStreamStatus;
  session_id?: string;
  message?: string;
  chunk?: string;
  explanation?: string;
  diagram?: string;
  graph?: DiagramGraph;
  graph_attempts?: GraphAttemptAudit[];
  error?: string;
  error_code?: string;
  validation_error?: string;
  failure_stage?: string;
  latest_session_audit?: GenerationSessionAudit;
  generated_at?: string;
}

export interface DiagramCostResponse {
  cost?: string;
  error?: string;
  error_code?: string;
  ok?: boolean;
}

export interface StreamGenerationParams {
  username: string;
  repo: string;
  apiKey?: string;
  githubPat?: string;
}

export interface DiagramStateResponse {
  diagram: string | null;
  explanation: string | null;
  graph: DiagramGraph | null;
  latestSessionAudit: GenerationSessionAudit | null;
  lastSuccessfulAt: string | null;
}
