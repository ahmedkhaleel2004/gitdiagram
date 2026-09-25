/**
 * End-to-end films: new scripts (the director may see the README pictures),
 * designs and narration, with the director and designer models set apart.
 *
 *   bun --conditions=react-server experiments/video-bespoke/film.ts <config> [repo,...]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoArtifact } from "~/features/explainer/types";
import {
  createFilmWriters,
  type FilmImage,
  type Planner,
} from "~/server/explainer/director";
import { narrateBeats } from "~/server/explainer/narration";
import { probePicture } from "~/server/explainer/readme-images";
import type { VideoRepository } from "~/server/explainer/repository";
import { scriptWordCount } from "~/server/explainer/script";
import { normalizeShots } from "~/server/explainer/shots";
import { videoVersion } from "~/server/explainer/store";
import { REPOS } from "./design";
import { beatEnds, browser, grab } from "./frames";
import { pictureSystem } from "./prompts";

const OUT = join(process.cwd(), "experiments", "video-bespoke", "out");
const OPUS: Planner = { model: "claude-opus-5-5", effort: "low" };
const SOL: Planner = { model: "gpt-6-sol", effort: "medium" };

export const CONFIGS: Record<
  string,
  { director: Planner; designer: Planner; pictures: boolean }
> = {
  "sol-pics": { director: SOL, designer: SOL, pictures: true },
  "hybrid-pics": { director: OPUS, designer: SOL, pictures: true },
  "opus-pics": { director: OPUS, designer: OPUS, pictures: true },
  hybrid: { director: OPUS, designer: SOL, pictures: false },
};

const slugOf = (repo: string) => repo.replace("/", "__");
export const filmDir = (config: string, repo: string) =>
  join(OUT, "films", config, slugOf(repo).toLowerCase());

async function pictures(repo: string): Promise<FilmImage[]> {
  const found: FilmImage[] = [];
  for (let i = 1; i <= 3; i++) {
    const bytes = await readFile(
      join(OUT, "images", slugOf(repo), `img${i}.webp`),
    ).catch(() => null);
    if (!bytes) break;
    const meta = probePicture(bytes)!;
    found.push({
      id: `img${i}`,
      mediaType: meta.type,
      data: bytes.toString("base64"),
      width: meta.width,
      height: meta.height,
    });
  }
  return found;
}

async function makeFilm(configName: string, repo: string) {
  const config = CONFIGS[configName]!;
  const dir = filmDir(configName, repo);
  if (await readFile(join(dir, "artifact.json")).catch(() => null)) return dir;
  await mkdir(dir, { recursive: true });
  const repository = JSON.parse(
    await readFile(join(OUT, "repos", `${slugOf(repo)}.json`), "utf8"),
  ) as VideoRepository;
  const images = config.pictures ? await pictures(repo) : [];
  const options = {
    images,
    ...(config.pictures ? { system: pictureSystem() } : {}),
  };
  const director = createFilmWriters(
    repository.prompt,
    config.director,
    options,
  );
  const sameModel = config.director.model === config.designer.model;
  const designer = sameModel
    ? director
    : createFilmWriters(repository.prompt, config.designer, options);
  const started = Date.now();
  const script = await director.direct();
  const planMs = Date.now() - started;
  const [designed, narration] = await Promise.all([
    designer.design(script),
    narrateBeats(script.beats),
  ]);
  const designMs = Date.now() - started - planMs;
  const { plan, warnings } = normalizeShots(script, designed, {
    ...repository.facts,
    images: images.map((i) => i.id),
  });
  const cost =
    (director.usage.costUsd ?? 0) +
    (sameModel ? 0 : (designer.usage.costUsd ?? 0));
  const { owner, repo: name } = repository.meta;
  const artifact: VideoArtifact = {
    version: 2,
    repository: `${owner}/${name}`.toLowerCase(),
    createdAt: new Date().toISOString(),
    meta: repository.meta,
    plan: {
      ...plan,
      ...(images.length
        ? {
            images: Object.fromEntries(
              images.map((i) => [
                i.id,
                `/exp-images/${slugOf(repo)}/${i.id}.webp`,
              ]),
            ),
          }
        : {}),
    },
    timing: narration.timing,
    voices: narration.voices,
    stats: {
      totalMs: Date.now() - started,
      readMs: 0,
      planMs,
      voiceMs: designMs,
      planner: "api",
      model: `${config.director.model}+${config.designer.model}`,
      plannerCostUsd: cost,
      inputTokens: null,
      outputTokens: null,
      ttsCharacters: narration.characters,
      warnings,
    },
  };
  // The renderer reads narration from ./.video-cache under the working folder.
  const clips = join(
    dir,
    ".video-cache",
    "video",
    "v1",
    owner.toLowerCase(),
    name.toLowerCase(),
    videoVersion(artifact.createdAt)!,
  );
  await mkdir(clips, { recursive: true });
  await Promise.all(
    narration.clips.map((clip, index) =>
      writeFile(
        join(clips, `beat-${String(index).padStart(2, "0")}.mp3`),
        clip,
      ),
    ),
  );
  await writeFile(join(dir, "artifact.json"), JSON.stringify(artifact));
  await writeFile(
    join(dir, "report.json"),
    JSON.stringify(
      {
        config: configName,
        repo,
        planMs,
        designMs,
        totalMs: artifact.stats.totalMs,
        costUsd: cost,
        words: scriptWordCount(script),
        durationS: narration.timing.DURATION,
        ttsCharacters: narration.characters,
        warnings,
        script,
      },
      null,
      2,
    ),
  );
  console.info(
    `✓ ${configName} ${repo}: plan ${Math.round(planMs / 1000)}s + design ${Math.round(designMs / 1000)}s, $${cost.toFixed(3)}, ${narration.timing.DURATION.toFixed(0)}s film, ${warnings.length} warnings`,
  );
  return dir;
}

if (import.meta.main) {
  const [config, repos] = process.argv.slice(2) as [string, string?];
  if (!CONFIGS[config])
    throw new Error(`configs: ${Object.keys(CONFIGS).join(", ")}`);
  const list = repos?.split(",") ?? REPOS;
  const dirs = await Promise.all(
    list.map((repo) =>
      makeFilm(config, repo).catch((error) => {
        console.error(`✗ ${config} ${repo}`, error);
        return null;
      }),
    ),
  );
  for (const dir of dirs) {
    if (!dir) continue;
    const artifact = JSON.parse(
      await readFile(join(dir, "artifact.json"), "utf8"),
    ) as VideoArtifact;
    await grab(artifact, beatEnds(artifact), join(dir, "sheet"));
  }
  await (await browser()).close();
}
