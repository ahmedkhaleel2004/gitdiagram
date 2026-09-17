import type { GithubData } from "./github";
import type { AIProvider } from "./model-config";

export const MAX_SOURCE_CHARACTERS = 48_000;
export const MAX_SOURCE_FILES = 12;
export const MAX_SOURCE_FILE_BYTES = 96_000;
const MAX_TREE_CHARACTERS = 24_000;
const MAX_README_CHARACTERS = 16_000;

const EXCLUDED =
  /(^|\/)(?:\.[^/]+|tests?|__tests__|testdata|fixtures?|examples?|samples?|docs?|documentation|benchmarks?|vendor|third_party|node_modules|dist|build|generated|migrations?|alembic|assets|locales?|translations?)(\/|$)|(?:\.test(?:-d)?|\.spec|\.generated|\.min)\.|(?:^|\/)(?:test\.[^/]+|bench(?:mark|marker)?\.[^/]+|test_[^/]+|[^/]+_test\.[^/]+)$/i;
const SOURCE =
  /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|kts|swift|cs|cpp|cc|c|h|hpp|rb|php|ex|exs|scala|clj|vue|svelte|proto|graphql)$/i;
const MANIFEST =
  /(?:^|\/)(?:package\.json|Cargo\.toml|go\.mod|pyproject\.toml|requirements\.txt|build\.gradle(?:\.kts)?|mix\.exs|composer\.json|Gemfile|CMakeLists\.txt)$/i;
const SENSITIVE =
  /(?:^|\/)(?:.*(?:secrets?|credentials?|passwords?|private[_-]?key).*|\.env.*|.*\.(?:pem|key|p12|pfx))$/i;

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
  if (/^(?:main|app|server|application|Program)\./i.test(name)) value += 28;
  if (/^(?:index|lib|mod)\./i.test(name))
    value += path.split("/").length <= 3 ? 22 : 2;
  if (
    /(?:controller|manager|routes|query|ingest|search|auth|parser|context|session|templating)/i.test(
      name,
    )
  )
    value += 10;
  if (
    /(?:webhook|router|routes|handler|controller|tasks|worker|review_service|rag_service|llm_service|embedding_service|pipeline|engine|manager|repository|storage|database|client|service)/i.test(
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
  if (/(?:config|types|constants|utils|helpers|schema|models)/i.test(path))
    value -= 18;
  if (/(?:activity|service)\.(?:kt|java)$/i.test(name)) value += 18;
  if (/^I[A-Z].*\.(?:java|kt|cs)$/.test(name) || /\.d\.ts$/.test(name))
    value -= 20;
  return value;
}

export function selectSourcePaths(
  data: Pick<GithubData, "pathTypes" | "sourceBlobs">,
): string[] {
  const candidates = [...data.pathTypes]
    .filter(([path, type]) => {
      const blob = data.sourceBlobs?.get(path);
      return (
        type === "blob" &&
        isArchitectureSource(path) &&
        (!blob || blob.size <= MAX_SOURCE_FILE_BYTES)
      );
    })
    .map(([path]) => path)
    .sort((a, b) => score(b) - score(a) || a.localeCompare(b));
  const selected: string[] = [];
  const directories = new Map<string, number>();
  // A soft diversity penalty lets important siblings coexist while keeping
  // another subsystem's entry point ahead of an inventory of helper files.
  const remaining = new Set(candidates);
  let manifests = 0;
  while (remaining.size && selected.length < MAX_SOURCE_FILES) {
    const ranked = [...remaining]
      .filter((path) => !MANIFEST.test(path) || manifests < 1)
      .sort((a, b) => {
        const priority = (path: string) =>
          score(path) -
          5 *
            (directories.get(
              path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
            ) ?? 0);
        return priority(b) - priority(a) || a.localeCompare(b);
      });
    const path = ranked[0];
    if (!path) break;
    remaining.delete(path);
    selected.push(path);
    const directory = path.includes("/")
      ? path.slice(0, path.lastIndexOf("/"))
      : "";
    directories.set(directory, (directories.get(directory) ?? 0) + 1);
    if (MANIFEST.test(path)) manifests++;
  }
  return selected;
}

export function prepareRepositoryContext(data: GithubData) {
  const selectedPaths = selectSourcePaths(data);
  const allPaths = data.fileTree.split("\n");
  const ordered = [
    ...new Set([
      ...selectedPaths,
      ...allPaths.filter(
        (path) => data.pathTypes.get(path) === "tree" && !EXCLUDED.test(path),
      ),
      ...allPaths.filter(isArchitectureSource),
      ...allPaths,
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
    fileTree: paths.sort().join("\n"),
    readme:
      data.readme.length > MAX_README_CHARACTERS
        ? `${data.readme.slice(0, MAX_README_CHARACTERS)}\n[README excerpt ends here.]`
        : data.readme,
    treeTruncated: paths.length < allPaths.length,
  };
}

export function selectAnalysisModel(params: {
  provider: AIProvider;
  model: string;
  apiKey?: string;
  pathTypes: GithubData["pathTypes"];
}): string {
  // Preserve custom providers/models and user-supplied key billing expectations.
  if (
    params.provider !== "openai" ||
    params.apiKey ||
    !/^gpt-5\.6-luna(?:-\d{4}-\d{2}-\d{2})?$/.test(params.model)
  )
    return params.model;
  const sourcePaths = [...params.pathTypes]
    .filter(
      ([path, type]) =>
        type === "blob" && isArchitectureSource(path) && !MANIFEST.test(path),
    )
    .map(([path]) => path);
  // Reserve the all-Luna path for genuinely small, single-purpose codebases.
  return sourcePaths.length <= 8 ? params.model : "gpt-5.6-terra";
}
