import type { GithubData } from "./github";
import type { AIProvider } from "./model-config";

export const MAX_SOURCE_CHARACTERS = 48_000;
export const MAX_SOURCE_FILES = 12;
// Framework entry points can be large (FastAPI routing, editor controllers).
// Read them within a byte bound, then excerpt into the unchanged model budget.
export const MAX_SOURCE_FILE_BYTES = 512_000;
// Beyond the excerpted files, the next-ranked ones are read in full only to
// list what they import (source-references.ts), and a few more are listed by
// name and size, so the model knows which core modules exist and which
// connections were actually seen. Neither adds excerpt text.
export const MAX_REFERENCE_FILES = 28;
const MAX_LISTED_FILES = 20;
const MAX_TREE_CHARACTERS = 24_000;
const MAX_README_CHARACTERS = 8_500;

const EXCLUDED =
  /(^|\/)(?:\.[^/]+|tests?|__tests__|__mocks__|mocks?|testdata|fixtures?|e2e|cypress|examples?(?:_src)?|samples?|demos?|stories|storybook|docs?(?:_src)?|tutorials?(?:_src)?|documentation|bench|benchmarks?|vendor|third_party|node_modules|dist|build|generated|migrations?|alembic|assets|locales?|translations?)(\/|$)|(?:\.test(?:-d)?|\.spec|\.generated|\.min|\.stories|\.designer)\.|(?:_pb2(?:_grpc)?\.py|\.pb(?:\.gw)?\.go|\.g\.cs)$|(?:^|\/)(?:test\.[^/]+|bench(?:mark|marker)?\.[^/]+|test_[^/]+|[^/]+_test\.[^/]+)$/i;
// Module files that often only declare or re-export their siblings.
const BARREL = /(?:^|\/)(?:index|mod|__init__)\.[^/]+$/i;
const SOURCE =
  /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|kts|swift|cs|cpp|cc|c|h|hpp|rb|php|ex|exs|scala|clj|vue|svelte|proto|graphql)$/i;
const MANIFEST =
  /(?:^|\/)(?:package\.json|Cargo\.toml|go\.mod|pyproject\.toml|requirements\.txt|build\.gradle(?:\.kts)?|mix\.exs|composer\.json|Gemfile|CMakeLists\.txt)$/i;
const SENSITIVE =
  /(?:^|\/)(?:.*(?:secrets?|credentials?|passwords?|private[_-]?key).*|\.env.*|.*\.(?:pem|key|p12|pfx))$/i;

export function isManifestPath(path: string): boolean {
  return MANIFEST.test(path);
}

export function isArchitectureSource(path: string): boolean {
  return (
    !EXCLUDED.test(path) &&
    !SENSITIVE.test(path) &&
    (SOURCE.test(path) || MANIFEST.test(path))
  );
}

function score(path: string): number {
  const name = path.split("/").at(-1) ?? path;
  let value = 20 - path.split("/").length;
  if (MANIFEST.test(path)) value += path.includes("/") ? 5 : 45;
  if (/^(?:main|apps?|server|applications?|Program)\./i.test(name)) value += 28;
  // File-based frameworks put the actual request boundary in singular route
  // files. Without this, generic client helpers crowd out the product's API.
  if (/^(?:route|\+server|\+page\.server)\.[cm]?[jt]sx?$/i.test(name))
    value += 32;
  if (/page-client\.[cm]?[jt]sx?$/i.test(name)) value += 22;
  // A file-based app's own screen, not just its API routes.
  if (/^page\.[jt]sx$/i.test(name)) value += 16;
  if (/^use[A-Z].*\.[cm]?[jt]sx?$/.test(name)) value += 22;
  if (/^(?:index|lib|mod)\./i.test(name))
    value += path.split("/").length <= 3 ? 22 : 2;
  if (
    /(?:controller|manager|routes|query|ingest|search|auth|parser|context|session|templating)/i.test(
      name,
    )
  )
    value += 10;
  if (
    /(?:webhook|router|routes|routing|handler|controller|tasks|worker|review_service|rag_service|llm_service|embedding_service|pipeline|engine|manager|repository|storage|database|client|service)/i.test(
      name,
    )
  )
    value += 22;
  if (
    /(?:pipeline|engine|orchestrat|review|retriev|embedding|inference|llm|rag|query|ingest)/i.test(
      name,
    )
  )
    value += 18;
  if (/(?:config|types|constants|utils|helpers|schema|models)/i.test(name))
    value -= 6;
  if (/(?:analytics|telemetry|instrumentation|logger|logging)/i.test(name))
    value -= 25;
  if (/(?:^|\/)(?:healthz?|readyz?|livez?)(?:\/|\.)/i.test(path)) value -= 30;
  if (/(?:^|\/)scripts?\//i.test(path)) value -= 35;
  if (/^(?:testclient|conftest)\./i.test(name)) value -= 35;
  if (/(?:activity|service)\.(?:kt|java)$/i.test(name)) value += 18;
  if (/^I[A-Z].*\.(?:java|kt|cs)$/.test(name) || /\.d\.ts$/.test(name))
    value -= 20;
  return value;
}

type SourceCandidate = {
  path: string;
  directory: string;
  /** The directory's first two segments: sibling route folders share one. */
  area: string;
  score: number;
  /** The score with the size adjustments, before the diversity penalty. */
  base: number;
  manifest: boolean;
};

/**
 * Whether `a` ranks ahead of `b`: higher priority, then locale order, then
 * (for paths that compare equal) higher score and the tree's own order, which
 * is where a stable sort of the candidates would have left them.
 */
function ranksAhead(
  a: SourceCandidate,
  aPriority: number,
  b: SourceCandidate,
  bPriority: number,
): boolean {
  if (aPriority !== bPriority) return aPriority > bPriority;
  const order = a.path.localeCompare(b.path);
  if (order !== 0) return order < 0;
  return a.score > b.score;
}

/**
 * Source files in the order they are worth reading. The first
 * `MAX_SOURCE_FILES` are excerpted for the model; later ones are read only for
 * their references or listed by name (`prepareRepositoryContext`).
 */
export function rankSourcePaths(
  data: Pick<GithubData, "pathTypes" | "sourceBlobs">,
  limit: number,
): string[] {
  // Scores are fixed per path, so they are computed once; each pick is then
  // one pass over the candidates (in tree order) with only the diversity
  // penalty changing between picks.
  const candidates: SourceCandidate[] = [];
  for (const [path, type] of data.pathTypes) {
    const size = data.sourceBlobs?.get(path)?.size;
    if (
      type !== "blob" ||
      !isArchitectureSource(path) ||
      (size !== undefined && size > MAX_SOURCE_FILE_BYTES)
    )
      continue;
    const value = score(path);
    const directory = path.includes("/")
      ? path.slice(0, path.lastIndexOf("/"))
      : "";
    candidates.push({
      path,
      directory,
      area: directory.split("/").slice(0, 2).join("/"),
      score: value,
      base:
        value -
        // Empty package barrels and tiny wrappers should not crowd out
        // substantial runtime modules; size is only a modest tie-breaker.
        (size !== undefined && size < 250 ? 15 : 0) -
        // A small mod.rs/index/__init__ usually only names its siblings,
        // which the tree already shows; the siblings hold the behavior.
        (size !== undefined && size < 2000 && BARREL.test(path) ? 18 : 0) +
        Math.min(10, Math.log2(1 + (size ?? 0) / 1000)),
      manifest: MANIFEST.test(path),
    });
  }
  const selected: string[] = [];
  const directories = new Map<string, number>();
  const areas = new Map<string, number>();
  // A soft diversity penalty lets important siblings coexist while keeping
  // another subsystem's entry point ahead of an inventory of helper files.
  // The area penalty stops one family of folders (app/api/*/route.ts, one
  // folder per route) from taking every slot from the UI and libraries.
  // Priorities are kept per candidate and recomputed only for the picked
  // file's directory and area, so each pick is a plain scan.
  const priorities = candidates.map((candidate) => candidate.base);
  const byGroup = new Map<string, number[]>();
  candidates.forEach((candidate, index) => {
    for (const key of [`d:${candidate.directory}`, `a:${candidate.area}`]) {
      const members = byGroup.get(key);
      if (members) members.push(index);
      else byGroup.set(key, [index]);
    }
  });
  const taken = new Uint8Array(candidates.length);
  let manifests = 0;
  while (selected.length < limit) {
    let best = -1;
    for (let index = 0; index < candidates.length; index++) {
      if (taken[index] || (candidates[index]!.manifest && manifests >= 1))
        continue;
      if (
        best === -1 ||
        ranksAhead(
          candidates[index]!,
          priorities[index]!,
          candidates[best]!,
          priorities[best]!,
        )
      )
        best = index;
    }
    if (best === -1) break;
    const picked = candidates[best]!;
    taken[best] = 1;
    selected.push(picked.path);
    directories.set(
      picked.directory,
      (directories.get(picked.directory) ?? 0) + 1,
    );
    areas.set(picked.area, (areas.get(picked.area) ?? 0) + 1);
    if (picked.manifest) manifests++;
    for (const key of [`d:${picked.directory}`, `a:${picked.area}`])
      for (const index of byGroup.get(key) ?? []) {
        const candidate = candidates[index]!;
        priorities[index] =
          candidate.base -
          5 * (directories.get(candidate.directory) ?? 0) -
          3 * (areas.get(candidate.area) ?? 0);
      }
  }
  return selected;
}

export function selectSourcePaths(
  data: Pick<GithubData, "pathTypes" | "sourceBlobs">,
): string[] {
  return rankSourcePaths(data, MAX_SOURCE_FILES);
}

export function prepareRepositoryContext(data: GithubData) {
  const ranked = rankSourcePaths(
    data,
    MAX_SOURCE_FILES + MAX_REFERENCE_FILES + MAX_LISTED_FILES,
  );
  const selectedPaths = ranked.slice(0, MAX_SOURCE_FILES);
  const referencePaths = ranked.slice(
    MAX_SOURCE_FILES,
    MAX_SOURCE_FILES + MAX_REFERENCE_FILES,
  );
  const listedPaths = ranked.slice(MAX_SOURCE_FILES + MAX_REFERENCE_FILES);
  const allPaths = data.fileTree.split("\n");
  const runtimePaths = allPaths.filter(isArchitectureSource);
  // Large code repositories do not need test/asset inventories in the model
  // prompt. Keep the original tree for small or primarily non-code projects.
  const contextPaths = runtimePaths.length > 40 ? runtimePaths : allPaths;
  const ordered = [
    ...new Set([
      ...ranked,
      ...contextPaths.filter(
        (path) => data.pathTypes.get(path) === "tree" && !EXCLUDED.test(path),
      ),
      ...runtimePaths,
      ...contextPaths,
    ]),
  ];
  const paths: string[] = [];
  let characters = 0;
  for (const path of ordered) {
    if (characters + path.length + 1 > MAX_TREE_CHARACTERS) continue;
    paths.push(path);
    characters += path.length + 1;
  }
  return {
    selectedPaths,
    referencePaths,
    listedPaths,
    fileTree: paths.sort().join("\n"),
    readme:
      data.readme.length > MAX_README_CHARACTERS
        ? `${data.readme.slice(0, MAX_README_CHARACTERS)}\n[README excerpt ends here.]`
        : data.readme,
    // GitHub's own partial listing counts too: the tree excerpt may then
    // miss parts of the repository even when every listed path fits.
    treeTruncated:
      Boolean(data.treeTruncated) || paths.length < allPaths.length,
  };
}

export function selectAnalysisModel(params: {
  provider: AIProvider;
  model: string;
  apiKey?: string;
}): string {
  // Honor the configured model for every stage; never silently escalate cost.
  return params.model;
}
