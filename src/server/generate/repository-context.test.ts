import { describe, expect, it } from "vitest";
import type { GithubData } from "./github";
import {
  isArchitectureSource,
  prepareRepositoryContext,
  selectAnalysisModel,
  selectSourcePaths,
  MAX_SOURCE_FILE_BYTES,
} from "./repository-context";

function repository(paths: string[]): GithubData {
  return {
    defaultBranch: "main",
    fileTree: paths.join("\n"),
    readme: "README",
    isPrivate: false,
    stargazerCount: 0,
    pathTypes: new Map(paths.map((p) => [p, "blob"])),
  };
}

describe("repository evidence preparation", () => {
  it("keeps large framework entry points eligible while bounding fetched bytes", () => {
    const data = repository([
      "fastapi/applications.py",
      "fastapi/routing.py",
      "src/generated-client.ts",
    ]);
    data.sourceBlobs = new Map([
      ["fastapi/applications.py", { sha: "a".repeat(40), size: 220_000 }],
      ["fastapi/routing.py", { sha: "b".repeat(40), size: 180_000 }],
      [
        "src/generated-client.ts",
        { sha: "c".repeat(40), size: MAX_SOURCE_FILE_BYTES + 1 },
      ],
    ]);
    expect(selectSourcePaths(data)).toEqual([
      "fastapi/applications.py",
      "fastapi/routing.py",
    ]);
  });
  it("samples file-based API entry points and their client lifecycle before peripheral helpers", () => {
    const selected = selectSourcePaths(
      repository([
        "package.json",
        "src/app/[owner]/[repo]/repo-page-client.tsx",
        "src/app/api/generate/stream/route.ts",
        "src/app/api/generate/cancel/route.ts",
        "src/app/api/diagram-state/route.ts",
        "src/app/api/healthz/route.ts",
        "src/hooks/useDiagram.ts",
        "src/lib/analytics-client.ts",
        "scripts/check-performance-budgets.mjs",
        ...Array.from({ length: 20 }, (_, i) => `src/helpers/client_${i}.ts`),
      ]),
    );
    expect(selected).toEqual(
      expect.arrayContaining([
        "src/app/[owner]/[repo]/repo-page-client.tsx",
        "src/app/api/generate/stream/route.ts",
        "src/app/api/generate/cancel/route.ts",
        "src/app/api/diagram-state/route.ts",
        "src/hooks/useDiagram.ts",
      ]),
    );
    expect(selected).not.toContain("scripts/check-performance-budgets.mjs");
    expect(
      selected.indexOf("src/app/api/generate/stream/route.ts"),
    ).toBeLessThan(
      selected.includes("src/lib/analytics-client.ts")
        ? selected.indexOf("src/lib/analytics-client.ts")
        : Infinity,
    );
    expect(selected.slice(0, 6)).not.toContain("src/app/api/healthz/route.ts");
  });
  it("keeps runtime stages instead of letting schemas and maintenance crowd them out", () => {
    const paths = [
      "pyproject.toml",
      "requirements.txt",
      "app/main.py",
      "app/api/v1/webhooks.py",
      "app/api/v1/router.py",
      "app/workers/tasks.py",
      ...["review", "rag", "llm", "embedding", "github"].map(
        (s) => `app/services/${s}_service.py`,
      ),
      ...Array.from({ length: 40 }, (_, i) => `app/schemas/record_${i}.py`),
      "alembic/env.py",
    ];
    const selected = selectSourcePaths(repository(paths));
    expect(selected).toEqual(
      expect.arrayContaining([
        "app/api/v1/webhooks.py",
        "app/workers/tasks.py",
        "app/services/review_service.py",
        "app/services/rag_service.py",
        "app/services/llm_service.py",
      ]),
    );
    expect(selected).not.toContain("alembic/env.py");
    expect(selected.length).toBeLessThanOrEqual(12);
  });
  it.each([
    ".env",
    "src/secrets.ts",
    "credentials.json",
    "src/private_key.py",
    "src/api.test.ts",
    "tests/main.py",
    "vendor/server.go",
    "dist/index.js",
    "assets/x.js",
    "bench/index.js",
    "docs_src/tutorial/main.py",
    "examples_src/server/main.py",
  ])("excludes sensitive, generated and maintenance source %s", (path) => {
    expect(isArchitectureSource(path)).toBe(false);
  });
  it("bounds model context without changing the original path lookup", () => {
    const data = repository([
      "src/main.ts",
      ...Array.from(
        { length: 5000 },
        (_, i) => `src/feature_${i}/implementation.ts`,
      ),
    ]);
    data.readme = "A".repeat(100000);
    const context = prepareRepositoryContext(data);
    expect(context.fileTree.length).toBeLessThanOrEqual(24000);
    expect(context.readme.length).toBeLessThan(16100);
    expect(context.fileTree.split("\n")).toContain("src/main.ts");
    expect(data.pathTypes.size).toBe(5001);
    expect(context.treeTruncated).toBe(true);
  });
  it("reports GitHub's partial listing even when every listed path fits", () => {
    const data = repository(["src/main.ts"]);
    expect(prepareRepositoryContext(data).treeTruncated).toBe(false);
    data.treeTruncated = true;
    expect(prepareRepositoryContext(data).treeTruncated).toBe(true);
  });
});

describe("analysis model routing", () => {
  it("keeps managed architecture on the affordable configured model", () => {
    expect(
      selectAnalysisModel({ provider: "openai", model: "gpt-5.6-luna" }),
    ).toBe("gpt-5.6-luna");
  });
  it("preserves custom model and BYOK choices", () => {
    for (const params of [
      { provider: "openai" as const, model: "gpt-5.4" },
      { provider: "openrouter" as const, model: "openai/gpt-5.6-luna" },
      {
        provider: "openai" as const,
        model: "gpt-5.6-luna",
        apiKey: "user-key",
      },
    ]) {
      expect(selectAnalysisModel(params)).toBe(params.model);
    }
  });
});
