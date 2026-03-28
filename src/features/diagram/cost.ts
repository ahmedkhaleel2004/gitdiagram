export interface GenerationTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export interface GenerationCostSummary {
  kind: "estimate" | "actual";
  approximate: boolean;
  amountUsd: number;
  display: string;
  pricingModel: string;
  usage: GenerationTokenUsage;
  note?: string;
}

export interface GenerationStageUsage {
  stage: "estimate" | "explanation" | "graph_attempt";
  attempt?: number;
  model: string;
  costSummary: GenerationCostSummary;
  createdAt: string;
}
