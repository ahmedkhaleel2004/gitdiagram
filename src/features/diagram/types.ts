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
