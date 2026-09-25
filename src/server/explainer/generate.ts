import "server-only";

import type {
  VideoArtifact,
  VideoGenerationEvent,
} from "~/features/explainer/types";
import { createFilmWriters } from "./director";
import { narrateBeats } from "./narration";
import { readRepositoryForVideo } from "./repository";
import { normalizeShots } from "./shots";
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

  // The director writes the script; then every scene is designed in parallel
  // while the narration is recorded, since the voice only needs the words.
  onEvent({
    status: "planning",
    elapsedMs: readMs,
    progress: { sourceFiles: repository.sourceFileCount },
  });
  const writers = createFilmWriters(repository.prompt);
  const script = await writers.direct(signal);
  const planMs = elapsedMs() - readMs;

  // Scenes are designed in parallel while the whole script is voiced in one
  // take; each finished scene, and the take, is reported.
  const narrationLines = script.beats.map((beat) => beat.narration);
  const scenes = new Set(script.beats.map((beat) => beat.scene)).size;
  const progress = {
    sourceFiles: repository.sourceFileCount,
    scenes,
    beats: script.beats.length,
    words: narrationLines.join(" ").split(/\s+/).filter(Boolean).length,
    narration: narrationLines,
    designed: 0,
    voiced: 0,
  };
  const report = () =>
    onEvent({ status: "designing", elapsedMs: elapsedMs(), progress });
  report();
  const [designed, narration] = await Promise.all([
    writers.design(script, signal, () => {
      progress.designed++;
      report();
    }),
    narrateBeats(script.beats, signal).then((narration) => {
      progress.voiced = scenes;
      report();
      return narration;
    }),
  ]);
  const { plan, warnings } = normalizeShots(script, designed, repository.facts);
  const voiceMs = elapsedMs() - readMs - planMs;

  onEvent({ status: "saving", elapsedMs: elapsedMs() });
  const artifact: VideoArtifact = {
    version: 2,
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
      planner: "api",
      model: writers.model,
      plannerCostUsd: writers.usage.costUsd,
      inputTokens: writers.usage.inputTokens,
      outputTokens: writers.usage.outputTokens,
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
      readMs,
      planMs,
      designMs: voiceMs,
      calls: writers.usage.calls,
      costUsd: writers.usage.costUsd,
      warnings,
    }),
  );
  return artifact;
}
