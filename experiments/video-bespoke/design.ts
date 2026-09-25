/**
 * Visual experiments on fixed scripts: each base film (script, narration take,
 * timing) is re-designed under a variant, so only the pictures change and no
 * new narration is paid for.
 *
 *   bun --conditions=react-server experiments/video-bespoke/design.ts <variant> [base,...] [repo,...]
 */
import OpenAI from "openai";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoArtifact } from "~/features/explainer/types";
import { createFilmWriters, type FilmImage } from "~/server/explainer/director";
import type { VideoRepository } from "~/server/explainer/repository";
import { normalizeShots, type Script } from "~/server/explainer/shots";
import { beatEnds, browser, grab } from "./frames";
import { artSystem } from "./prompts";

const OUT = join(process.cwd(), "experiments", "video-bespoke", "out");
export const BASES = {
  "opus-low": { model: "claude-opus-5-5", effort: "low" },
  "sol-medium": { model: "gpt-6-sol", effort: "medium" },
} as const;
export const REPOS = [
  "fastapi/fastapi",
  "BurntSushi/ripgrep",
  "pmndrs/zustand",
  "excalidraw/excalidraw",
];

type Variant = {
  /** New designs (false: keep the base film's designs). */
  redesign: boolean;
  /** Production's visual direction instead of the art-direction rewrite. */
  art?: boolean;
  pictures?: boolean;
  thread?: boolean;
  flags: { camera?: "auto"; type?: "big"; carry?: boolean };
};

export const VARIANTS: Record<string, Variant> = {
  base: { redesign: false, flags: {} },
  cam: { redesign: false, flags: { camera: "auto", type: "big" } },
  art: { redesign: true, flags: { camera: "auto", type: "big" } },
  full: {
    redesign: true,
    pictures: true,
    thread: true,
    flags: { camera: "auto", type: "big", carry: true },
  },
  pics: {
    redesign: true,
    art: false,
    pictures: true,
    flags: { camera: "auto", type: "big" },
  },
};

const slugOf = (repo: string) => repo.replace("/", "__");
const baseDir = (base: string, repo: string) =>
  join(
    OUT,
    "base",
    base,
    ".video-cache/video/v1",
    ...repo.toLowerCase().split("/"),
  );
export const variantDir = (variant: string, base: string, repo: string) =>
  join(OUT, "variants", variant, base, slugOf(repo).toLowerCase());

async function pictures(repo: string): Promise<FilmImage[]> {
  const dir = join(OUT, "images", slugOf(repo));
  const found: FilmImage[] = [];
  for (let i = 1; i <= 3; i++) {
    const bytes = await readFile(join(dir, `img${i}.webp`)).catch(() => null);
    if (!bytes) break;
    const sharp = (await import("sharp")).default;
    const meta = await sharp(bytes).metadata();
    found.push({
      id: `img${i}`,
      mediaType: "image/webp",
      data: bytes.toString("base64"),
      width: meta.width!,
      height: meta.height!,
    });
  }
  return found;
}

// Production's director call writes the prompt cache before the designers
// run; here the designers come first, so one call writes it for them.
async function warm(run: () => Promise<void>) {
  await run().catch((error) => console.warn("warm failed", error));
}

/** The film's thread object, named once per script (a cheap call). */
async function threadOf(script: Script, dir: string) {
  const path = join(dir, "thread.json");
  const cached = await readFile(path, "utf8").catch(() => null);
  if (cached) return JSON.parse(cached) as { kind: string; text: string };
  const client = new OpenAI();
  const response = await client.responses.create({
    model: "gpt-6-sol",
    reasoning: { effort: "low" },
    instructions:
      'A short explainer film follows one continuous object through its story (a request, a command, a file, a value, a document). Name it as it would appear on screen. Reply with only JSON: {"kind": "chip" | "request" | "box" | "file", "text": "at most 28 characters, the literal on-screen text, e.g. GET /items/42 or rg -i rustacean"}.',
    input: script.beats
      .map((b) => `[${b.scene}] ${b.narration} — ${b.brief}`)
      .join("\n"),
  });
  const text = response.output_text;
  const thread = JSON.parse(
    text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1),
  );
  await writeFile(path, JSON.stringify(thread));
  return thread as { kind: string; text: string };
}

async function runOne(
  variantName: string,
  base: keyof typeof BASES,
  repo: string,
) {
  const variant = VARIANTS[variantName]!;
  const dir = variantDir(variantName, base, repo);
  await mkdir(dir, { recursive: true });
  if (await readFile(join(dir, "artifact.json")).catch(() => null)) return dir;
  const repository = JSON.parse(
    await readFile(join(OUT, "repos", `${slugOf(repo)}.json`), "utf8"),
  ) as VideoRepository;
  const report = JSON.parse(
    await readFile(join(baseDir(base, repo), "report.json"), "utf8"),
  );
  const artifact = JSON.parse(
    await readFile(join(baseDir(base, repo), "artifact.json"), "utf8"),
  ) as VideoArtifact;
  const script = report.script as Script;
  const started = Date.now();
  let cost: number | null = 0;
  let warnings = artifact.stats.warnings;
  let plan = artifact.plan;
  let images: FilmImage[] = [];
  if (variant.redesign) {
    images = variant.pictures ? await pictures(repo) : [];
    const thread = variant.thread ? await threadOf(script, dir) : null;
    const writers = createFilmWriters(repository.prompt, BASES[base], {
      images,
      prompts: {
        system: artSystem({
          art: variant.art,
          pictures: variant.pictures,
          thread,
        }),
      },
    });
    if (base === "opus-low") await warm(writers.warmup);
    const designed = await writers.design(script);
    const normalized = normalizeShots(script, designed, {
      ...repository.facts,
      images: images.map((i) => i.id),
    });
    plan = normalized.plan;
    warnings = normalized.warnings;
    cost = writers.usage.costUsd;
  }
  const out: VideoArtifact = {
    ...artifact,
    plan: {
      ...plan,
      ...variant.flags,
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
  };
  await writeFile(join(dir, "artifact.json"), JSON.stringify(out));
  await writeFile(
    join(dir, "report.json"),
    JSON.stringify(
      {
        variant: variantName,
        base,
        repo,
        designMs: Date.now() - started,
        costUsd: cost,
        warnings,
      },
      null,
      2,
    ),
  );
  console.info(
    `✓ ${variantName} ${base} ${repo}: ${Math.round((Date.now() - started) / 1000)}s $${cost?.toFixed(3)} ${warnings.length} warnings`,
  );
  return dir;
}

if (import.meta.main) {
  const [variant, bases, repos] = process.argv.slice(2) as [
    string,
    string?,
    string?,
  ];
  if (!VARIANTS[variant])
    throw new Error(`variants: ${Object.keys(VARIANTS).join(", ")}`);
  const baseList = (bases?.split(",") ?? Object.keys(BASES)) as Array<
    keyof typeof BASES
  >;
  const repoList = repos?.split(",") ?? REPOS;
  const dirs = await Promise.all(
    baseList.flatMap((base) =>
      repoList.map((repo) =>
        runOne(variant, base, repo).catch((error) => {
          console.error(`✗ ${variant} ${base} ${repo}`, error);
          return null;
        }),
      ),
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
