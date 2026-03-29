import type { GenerationSessionAudit } from "~/features/diagram/graph";

export type ArtifactVisibility = "public" | "private";

export interface DiagramArtifact {
  version: 1;
  visibility: ArtifactVisibility;
  username: string;
  repo: string;
  diagram: string;
  explanation: string;
  graph: GenerationSessionAudit["graph"];
  generatedAt: string;
  usedOwnKey: boolean;
  latestSessionSummary: GenerationSessionAudit;
  lastSuccessfulAt: string;
}

export interface StoredFailureSummary {
  version: 1;
  visibility: ArtifactVisibility;
  username: string;
  repo: string;
  latestSessionSummary: GenerationSessionAudit;
}
