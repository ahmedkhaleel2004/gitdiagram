export type DiagramStreamStatus =
  | "idle"
  | "started"
  | "explanation_sent"
  | "explanation"
  | "explanation_chunk"
  | "mapping_sent"
  | "mapping"
  | "mapping_chunk"
  | "diagram_sent"
  | "diagram"
  | "diagram_chunk"
  | "diagram_fixing"
  | "diagram_fix_attempt"
  | "diagram_fix_chunk"
  | "diagram_fix_validating"
  | "complete"
  | "error";

export interface DiagramStreamState {
  status: DiagramStreamStatus;
  message?: string;
  explanation?: string;
  mapping?: string;
  diagram?: string;
  error?: string;
  errorCode?: string;
  parserError?: string;
  fixAttempt?: number;
  fixMaxAttempts?: number;
  fixDiagramDraft?: string;
}

export interface DiagramStreamMessage {
  status: DiagramStreamStatus;
  message?: string;
  chunk?: string;
  explanation?: string;
  mapping?: string;
  diagram?: string;
  error?: string;
  error_code?: string;
  parser_error?: string;
  fix_attempt?: number;
  fix_max_attempts?: number;
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
