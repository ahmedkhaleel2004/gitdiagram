import { describe, expect, it } from "vitest";
import type { GithubData } from "./github";
import {
  isArchitectureSource,
  prepareRepositoryContext,
  selectAnalysisModel,
  selectSourcePaths,
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
});

describe("analysis model routing", () => {
  const small = repository(["index.js", "test/index.js"]);
  const application = repository(
    Array.from({ length: 20 }, (_, i) => `src/component${i}.ts`),
  );
  it("keeps tiny libraries on Luna and uses Terra to analyze larger implementations", () => {
    expect(
      selectAnalysisModel({
        provider: "openai",
        model: "gpt-5.6-luna",
        pathTypes: small.pathTypes,
      }),
    ).toBe("gpt-5.6-luna");
    expect(
      selectAnalysisModel({
        provider: "openai",
        model: "gpt-5.6-luna",
        pathTypes: application.pathTypes,
      }),
    ).toBe("gpt-5.6-terra");
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
      expect(
        selectAnalysisModel({ ...params, pathTypes: application.pathTypes }),
      ).toBe(params.model);
    }
  });
});
