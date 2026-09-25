import { describe, expect, it } from "vitest";
import type { GithubData, RepositoryPathType, SourceBlob } from "./github";
import {
  isArchitectureSource,
  MAX_SOURCE_FILE_BYTES,
  MAX_SOURCE_FILES,
  selectSourcePaths,
} from "./repository-context";

// The source selection as it was before it was rewritten for speed: it
// re-sorted every candidate, recomputing scores, for each of the 12 picks
// (1.3 s for 50k paths, 2.9 s for 100k). Kept here only to prove the rewrite
// picks exactly the same files in the same order.
const MANIFEST =
  /(?:^|\/)(?:package\.json|Cargo\.toml|go\.mod|pyproject\.toml|requirements\.txt|build\.gradle(?:\.kts)?|mix\.exs|composer\.json|Gemfile|CMakeLists\.txt)$/i;

function legacyScore(path: string): number {
  const name = path.split("/").at(-1) ?? path;
  let value = 20 - path.split("/").length;
  if (MANIFEST.test(path)) value += path.includes("/") ? 5 : 45;
  if (/^(?:main|apps?|server|applications?|Program)\./i.test(name)) value += 28;
  if (/^(?:route|\+server|\+page\.server)\.[cm]?[jt]sx?$/i.test(name))
    value += 32;
  if (/page-client\.[cm]?[jt]sx?$/i.test(name)) value += 22;
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

function legacySelectSourcePaths(
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
    .sort((a, b) => legacyScore(b) - legacyScore(a) || a.localeCompare(b));
  const selected: string[] = [];
  const directories = new Map<string, number>();
  const remaining = new Set(candidates);
  let manifests = 0;
  while (remaining.size && selected.length < MAX_SOURCE_FILES) {
    const ranked = [...remaining]
      .filter((path) => !MANIFEST.test(path) || manifests < 1)
      .sort((a, b) => {
        const priority = (path: string) =>
          legacyScore(path) -
          (data.sourceBlobs?.get(path)?.size !== undefined &&
          data.sourceBlobs.get(path)!.size < 250
            ? 15
            : 0) +
          Math.min(
            10,
            Math.log2(1 + (data.sourceBlobs?.get(path)?.size ?? 0) / 1000),
          ) -
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

// A seeded generator, so a failure names a tree that can be rebuilt.
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRECTORIES = [
  "",
  "src",
  "src/app",
  "src/app/api/generate/stream",
  "src/server",
  "app",
  "server",
  "lib",
  "packages/core/src",
  "packages/web/src",
  "internal/pipeline",
  "cmd/api",
  "scripts",
  "health",
  "tests",
  "docs",
  "café",
  "café",
];
const NAMES = [
  "main",
  "app",
  "server",
  "index",
  "lib",
  "mod",
  "route",
  "+server",
  "+page.server",
  "repo-page-client",
  "useDiagram",
  "controller",
  "manager",
  "query",
  "ingest",
  "auth",
  "parser",
  "context",
  "webhook",
  "router",
  "handler",
  "worker",
  "pipeline",
  "engine",
  "repository",
  "storage",
  "client",
  "service",
  "retriever",
  "llm",
  "config",
  "types",
  "utils",
  "schema",
  "analytics",
  "logger",
  "healthz",
  "conftest",
  "UserActivity",
  "IService",
  "widget",
  "Widget",
  "café",
  "café",
];
const EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".py",
  ".go",
  ".java",
  ".kt",
  ".d.ts",
];
const MANIFESTS = ["package.json", "Cargo.toml", "go.mod", "pyproject.toml"];

function randomRepository(seed: number, count: number) {
  const next = random(seed);
  const pick = <T>(values: readonly T[]) =>
    values[Math.floor(next() * values.length)]!;
  const pathTypes = new Map<string, RepositoryPathType>();
  const sourceBlobs = new Map<string, SourceBlob>();
  const withSizes = next() < 0.7;
  // Big trees spread over numbered module folders, as monorepos do.
  const modules = Math.ceil(count / 200);
  while (pathTypes.size < count) {
    const directory =
      modules > 1 && next() < 0.9
        ? `modules/m${Math.floor(next() * modules)}/${pick(DIRECTORIES)}`
        : pick(DIRECTORIES);
    const file =
      next() < 0.08
        ? pick(MANIFESTS)
        : `${pick(NAMES)}${next() < 0.3 ? `_${Math.floor(next() * 4)}` : ""}${pick(EXTENSIONS)}`;
    const path = directory ? `${directory}/${file}` : file;
    pathTypes.set(path, next() < 0.05 ? "tree" : "blob");
    if (withSizes && next() < 0.8) {
      // Repeated sizes make exact priority ties, which the order must break
      // the same way.
      const size =
        next() < 0.3
          ? pick([0, 100, 249, 250, 1000, 4000])
          : Math.floor(next() * (next() < 0.1 ? 700_000 : 40_000));
      sourceBlobs.set(path, { sha: "a".repeat(40), size });
    }
  }
  return { pathTypes, sourceBlobs: withSizes ? sourceBlobs : undefined };
}

describe("source selection rewrite", () => {
  it("picks exactly what the previous implementation picked on random trees", () => {
    for (let seed = 1; seed <= 250; seed += 1) {
      const data = randomRepository(seed, 1 + (seed % 120));
      expect(selectSourcePaths(data), `seed ${seed}`).toEqual(
        legacySelectSourcePaths(data),
      );
    }
  }, 20_000);

  it("picks exactly what the previous implementation picked on larger trees", () => {
    for (let seed = 1_000; seed < 1_003; seed += 1) {
      const data = randomRepository(seed, 2_000);
      expect(selectSourcePaths(data), `seed ${seed}`).toEqual(
        legacySelectSourcePaths(data),
      );
    }
  }, 20_000);

  it("matches on trees made mostly of ties", () => {
    // Same names in many folders and no sizes: priorities tie everywhere, so
    // only the tie-breaks decide.
    const paths = Array.from(
      { length: 300 },
      (_, index) =>
        [
          `pkg${index % 17}/service.go`,
          `pkg${index % 17}/nested/Service.go`,
          `café/${index}/index.ts`,
          `café/${index}/index.ts`,
        ][index % 4]!,
    );
    const data = {
      pathTypes: new Map(paths.map((path) => [path, "blob" as const])),
    };
    expect(selectSourcePaths(data)).toEqual(legacySelectSourcePaths(data));
  });

  it("breaks ties between paths that compare equal the same way", () => {
    // Canonically equivalent names compare equal, so the tree order decides.
    const equivalent = Array.from({ length: 8 }, (_, index) => [
      `café/${index}/index.ts`,
      `café/${index}/index.ts`,
    ]).flat();
    expect(
      selectSourcePaths({
        pathTypes: new Map(equivalent.map((path) => [path, "blob"])),
      }),
    ).toEqual(
      legacySelectSourcePaths({
        pathTypes: new Map(equivalent.map((path) => [path, "blob"])),
      }),
    );
    // Equal priority and equal comparison, but different scores: the zero
    // width space hides "service" from the score (22 points), and the sizes
    // even the priorities out (-15 for a tiny file, +7 for 127 kB).
    const data = {
      pathTypes: new Map<string, RepositoryPathType>([
        ["api/serv​ice.go", "blob"],
        ["api/service.go", "blob"],
      ]),
      sourceBlobs: new Map([
        ["api/serv​ice.go", { sha: "a".repeat(40), size: 127_000 }],
        ["api/service.go", { sha: "b".repeat(40), size: 0 }],
      ]),
    };
    expect(selectSourcePaths(data)).toEqual(legacySelectSourcePaths(data));
    expect(selectSourcePaths(data)[0]).toBe("api/service.go");
  });

  it("stays fast on very large trees", () => {
    const data = randomRepository(7, 100_000);
    const started = performance.now();
    const selected = selectSourcePaths(data);
    const elapsed = performance.now() - started;
    expect(selected).toHaveLength(MAX_SOURCE_FILES);
    // The previous implementation took about 3 s here.
    expect(elapsed).toBeLessThan(2_000);
  });
});
