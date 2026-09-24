import "server-only";

import type {
  VideoArtifact,
  VideoGenerationEvent,
} from "~/features/video/types";
import { narratePlan } from "./narration";
import { normalizeVideoPlan } from "./plan-schema";
import { planVideo } from "./planner";
import { readRepositoryForVideo } from "./repository";
import { writeVideo } from "./store";

// One generation per repository per server instance; later callers share it.
const inFlight = new Map<string, Promise<VideoArtifact>>();

export function generateExplainerVideo(params: {
  username: string;
  repo: string;
  onEvent: (event: VideoGenerationEvent) => void;
  signal?: AbortSignal;
}): Promise<VideoArtifact> {
  const key = `${params.username}/${params.repo}`.toLowerCase();
  const running = inFlight.get(key);
  if (running) {
    params.onEvent({ status: "planning", elapsedMs: 0 });
    return running;
  }
  const job = run(params).finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

async function run({
  username,
  repo,
  onEvent,
  signal,
}: {
  username: string;
  repo: string;
  onEvent: (event: VideoGenerationEvent) => void;
  signal?: AbortSignal;
}): Promise<VideoArtifact> {
  const started = Date.now();
  const elapsedMs = () => Date.now() - started;

  onEvent({ status: "reading", elapsedMs: 0 });
  const repository = await readRepositoryForVideo({ username, repo, signal });
  const readMs = elapsedMs();

  onEvent({ status: "planning", elapsedMs: readMs });
  const planned = await planVideo(repository.prompt, signal);
  const { plan, warnings } = normalizeVideoPlan(planned.plan, repository.facts);
  const planMs = elapsedMs() - readMs;

  onEvent({ status: "voicing", elapsedMs: elapsedMs() });
  const narration = await narratePlan(plan, signal);
  const voiceMs = elapsedMs() - readMs - planMs;

  onEvent({ status: "saving", elapsedMs: elapsedMs() });
  const artifact: VideoArtifact = {
    version: 1,
    repository: `${username}/${repo}`.toLowerCase(),
    createdAt: new Date().toISOString(),
    meta: repository.meta,
    plan,
    timing: narration.timing,
    voices: narration.voices,
    stats: {
      totalMs: 0,
      readMs,
      planMs,
      voiceMs,
      planner: planned.planner,
      model: planned.model,
      plannerCostUsd: planned.costUsd,
      inputTokens: planned.inputTokens,
      outputTokens: planned.outputTokens,
      ttsCharacters: narration.characters,
      warnings,
    },
  };
  artifact.stats.totalMs = elapsedMs();
  await writeVideo(artifact, narration.clips);
  console.info(
    JSON.stringify({
      event: "video.generated",
      repository: artifact.repository,
      totalMs: artifact.stats.totalMs,
      planner: planned.planner,
      costUsd: planned.costUsd,
      warnings: warnings.length,
    }),
  );
  return artifact;
}
