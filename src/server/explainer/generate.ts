import "server-only";

import type {
  VideoArtifact,
  VideoGenerationEvent,
} from "~/features/explainer/types";
import { createFilmWriters, designGroups, type Planner } from "./director";
import { narrateBeats } from "./narration";
import { readRepositoryForVideo } from "./repository";
import { normalizeShots } from "./shots";
import { writeVideo } from "./store";

/**
 * Make and store one repository's video. The route holds the per-repository
 * lock, so only one run per repository happens at a time.
 *
 * `signal` is the run's deadline. `onPaidWork` is called just before the
 * first model call: a failure before it cost nothing. `choosePlanner` picks
 * the model once the repository's star count is known (the premium model by
 * default). When this rejects, nothing it started is still running, so the
 * caller may release its lock.
 */
export async function generateExplainerVideo({
  username,
  repo,
  onEvent,
  onPaidWork,
  choosePlanner,
  signal: deadline,
}: {
  username: string;
  repo: string;
  onEvent: (event: VideoGenerationEvent) => void;
  onPaidWork?: () => void;
  choosePlanner?: (repository: { stars: number }) => Promise<Planner>;
  signal?: AbortSignal;
}): Promise<VideoArtifact> {
  const started = Date.now();
  const elapsedMs = () => Date.now() - started;
  // Aborted by the deadline, or by this run when one of its parallel parts fails.
  const stop = new AbortController();
  const signal = deadline
    ? AbortSignal.any([deadline, stop.signal])
    : stop.signal;

  onEvent({ status: "reading", elapsedMs: 0 });
  const repository = await readRepositoryForVideo({ username, repo, signal });
  const readMs = elapsedMs();
  signal.throwIfAborted();
  const planner = await choosePlanner?.({ stars: repository.prompt.stars });

  // The director writes the script; then every scene is designed in parallel
  // while the narration is recorded, since the voice only needs the words.
  const writers = createFilmWriters(repository.prompt, planner, {
    images: repository.pictures,
  });
  onEvent({
    status: "planning",
    elapsedMs: readMs,
    progress: { sourceFiles: repository.sourceFileCount, model: writers.model },
  });
  signal.throwIfAborted();
  onPaidWork?.();
  const script = await writers.direct(signal);
  const planMs = elapsedMs() - readMs;

  // Scenes are designed in parallel while the whole script is voiced in one
  // take; each finished scene, and the take, is reported.
  const narrationLines = script.beats.map((beat) => beat.narration);
  const scenes = designGroups(script).length;
  const progress = {
    sourceFiles: repository.sourceFileCount,
    model: writers.model,
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
  // If either part fails, the other is stopped, and both have settled before
  // this returns, so no model or voice call outlives the run.
  let failure = null as { error: unknown } | null;
  const settle = <T>(work: Promise<T>) =>
    work.catch((error: unknown) => {
      failure ??= { error };
      stop.abort(error);
      throw error;
    });
  const designing = settle(
    writers.design(script, signal, () => {
      progress.designed++;
      report();
    }),
  );
  const voicing = settle(
    narrateBeats(script.beats, signal).then((narration) => {
      progress.voiced = scenes;
      report();
      return narration;
    }),
  );
  await Promise.allSettled([designing, voicing]);
  if (failure) throw failure.error;
  const [designed, narration] = await Promise.all([designing, voicing]);
  const { plan, warnings } = normalizeShots(script, designed, repository.facts);
  const voiceMs = elapsedMs() - readMs - planMs;
  signal.throwIfAborted();

  onEvent({ status: "saving", elapsedMs: elapsedMs() });
  const createdAt = new Date().toISOString();
  // Only pictures the film shows are stored, beside its narration.
  const shown = new Set(
    repository.pictures.length
      ? plan.beats.flatMap((beat) =>
          beat.elements.flatMap((element) =>
            element.kind === "image" ? [String(element.src)] : [],
          ),
        )
      : [],
  );
  const pictures = repository.pictures.filter((p) => shown.has(p.id));
  if (pictures.length)
    plan.images = Object.fromEntries(
      pictures.map((picture) => [
        picture.id,
        `/api/video/file?${new URLSearchParams({ username, repo, format: "picture", id: picture.id, v: createdAt })}`,
      ]),
    );
  const artifact: VideoArtifact = {
    version: 2,
    repository: `${username}/${repo}`.toLowerCase(),
    createdAt,
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
      voiceCostUsd: narration.costUsd,
      voice: narration.voice,
      warnings,
    },
  };
  artifact.stats.totalMs = elapsedMs();
  await writeVideo(artifact, narration.clips, pictures);
  console.info(
    JSON.stringify({
      event: "video.generated",
      repository: artifact.repository,
      totalMs: artifact.stats.totalMs,
      readMs,
      planMs,
      voiceMs,
      calls: writers.usage.calls,
      costUsd: writers.usage.costUsd,
      voiceCostUsd: narration.costUsd,
      model: writers.model,
      pictures: pictures.length,
      warnings,
    }),
  );
  return artifact;
}
