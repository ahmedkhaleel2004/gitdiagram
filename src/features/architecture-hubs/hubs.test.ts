import { describe, expect, it } from "vitest";
import {
  HUB_MIN_REPOSITORIES,
  HUB_PAGE_SIZE,
  buildHubs,
  candidatesToRead,
  hasLanguageHub,
  hubCandidates,
  hubHeading,
  hubPath,
  languageSlug,
  repositoryFacts,
  type HubCandidate,
  type HubDetails,
  type RepositoryFacts,
} from "./hubs";
import { hubFindings, hubTitle } from "./content";

const entry = (
  username: string,
  stars: number | null,
  language?: string,
  at = "2026-11-01T00:00:00.000Z",
) => ({
  username,
  repo: "app",
  stargazerCount: stars,
  lastSuccessfulAt: at,
  ...(language ? { language } : {}),
});

const facts = (traits: RepositoryFacts["t"]): RepositoryFacts => ({
  n: 12,
  t: traits,
  g: ["core"],
  s: ["SQLite"],
  f: ["main.py"],
});

function candidates(count: number, language: string, prefix = "u") {
  return Array.from({ length: count }, (_, index): HubCandidate => ({
    owner: `${prefix}${index}`,
    repo: "app",
    stars: 10_000 - index,
    language,
    at: "2026-11-01",
  }));
}

describe("languageSlug", () => {
  it("makes stable URL slugs for GitHub languages", () => {
    expect(languageSlug("C++")).toBe("cpp");
    expect(languageSlug("C#")).toBe("csharp");
    expect(languageSlug("Objective-C")).toBe("objective-c");
    expect(languageSlug("Vim Script")).toBe("vim-script");
  });

  it("gives markup and notebooks no hub", () => {
    expect(hasLanguageHub("Python")).toBe(true);
    expect(hasLanguageHub("HTML")).toBe(false);
    expect(hasLanguageHub("Jupyter Notebook")).toBe(false);
  });
});

describe("hubCandidates", () => {
  it("keeps repositories with a language and enough stars, most stars first", () => {
    const list = hubCandidates([
      entry("a", 50, "Go"),
      entry("b", 5, "Go"),
      entry("c", 500, "Go"),
      entry("d", 900),
      entry("e", null, "Go"),
      entry("C", 400, "Go"),
    ]);
    expect(list.map((item) => item.owner)).toEqual(["c", "a"]);
  });
});

describe("candidatesToRead", () => {
  it("reads new repositories and ones whose diagram was made again", () => {
    const list = candidates(3, "Go");
    const details: HubDetails["repositories"] = {
      "u0/app": { at: "2026-11-01" },
      "u1/app": { at: "2026-10-01" },
    };
    expect(candidatesToRead(list, details).map((item) => item.owner)).toEqual([
      "u1",
      "u2",
    ]);
  });
});

describe("repositoryFacts", () => {
  it("reads traits, data stores and linked files from the graph", () => {
    const result = repositoryFacts({
      nodes: [
        { label: "CLI", shape: "rect", path: "src/cli/main.py" },
        { label: "Agent loop", shape: "rect", path: "packages/agent/loop.ts" },
        { label: "OpenAI API", shape: "circle" },
        { label: "Postgres database", shape: "database" },
        { label: "Docs", shape: "rect", path: "README.md" },
      ],
      groups: [{ label: "Core" }],
    });
    expect(result.t).toEqual(
      expect.arrayContaining(["cli", "llm", "storage", "workspace", "agent"]),
    );
    expect(result.t).not.toContain("web");
    expect(result.s).toEqual(["PostgreSQL"]);
    expect(result.f).toEqual(["main.py", "loop.ts"]);
    expect(result.g).toEqual(["core"]);
  });

  it("needs two inner database parts for a database", () => {
    const one = repositoryFacts({
      nodes: [{ label: "Query planner" }],
      groups: [],
    });
    const two = repositoryFacts({
      nodes: [{ label: "Query planner" }, { label: "Write-ahead log" }],
      groups: [],
    });
    expect(one.t).not.toContain("dbengine");
    expect(two.t).toContain("dbengine");
  });
});

describe("buildHubs", () => {
  it("publishes only hubs with enough repositories, paginated", () => {
    const list = [
      ...candidates(HUB_PAGE_SIZE + 5, "Python", "p"),
      ...candidates(HUB_MIN_REPOSITORIES - 1, "Zig", "z"),
      ...candidates(HUB_MIN_REPOSITORIES, "HTML", "h"),
    ];
    const hubs = buildHubs(list, {});
    expect(hubs.map((hub) => hub.summary.slug)).toEqual(["python"]);
    const [python] = hubs;
    expect(python!.summary.total).toBe(HUB_PAGE_SIZE + 5);
    expect(python!.pages.map((page) => page.length)).toEqual([
      HUB_PAGE_SIZE,
      5,
    ]);
    expect(python!.summary.patterns).toBeNull();
    expect(python!.summary.top).toEqual(["p0/app", "p1/app", "p2/app"]);
  });

  it("leaves out missing diagrams and builds kinds from read facts", () => {
    const list = candidates(HUB_MIN_REPOSITORIES + 1, "Python");
    const details: HubDetails["repositories"] = Object.fromEntries(
      list.map((item, index) => [
        `${item.owner}/app`,
        index === 0
          ? { at: item.at, missing: true as const }
          : {
              at: item.at,
              d: `Repository ${index}.`,
              facts: facts(["cli", "storage"]),
            },
      ]),
    );
    const hubs = buildHubs(list, details);
    const python = hubs.find((hub) => hub.summary.slug === "python")!;
    expect(python.summary.total).toBe(HUB_MIN_REPOSITORIES);
    expect(python.pages[0]![0]).toEqual({
      owner: "u1",
      repo: "app",
      stars: 9_999,
      description: "Repository 1.",
    });
    const cli = hubs.find((hub) => hub.summary.slug === "cli-tools")!;
    expect(cli.summary.kind).toBe("type");
    expect(cli.pages[0]![0]!.language).toBe("Python");
    expect(
      cli.summary.patterns?.shares.find((s) => s.key === "cli")?.share,
    ).toBe(100);
    expect(cli.summary.patterns?.languages).toEqual([
      { name: "Python", repositories: HUB_MIN_REPOSITORIES },
    ]);
    expect(hubs.some((hub) => hub.summary.slug === "web-apps")).toBe(false);
  });
});

describe("hub words", () => {
  const list = candidates(HUB_MIN_REPOSITORIES, "Rust");
  const details: HubDetails["repositories"] = Object.fromEntries(
    list.map((item) => [
      `${item.owner}/app`,
      { at: item.at, facts: facts(["cli", "storage", "workspace"]) },
    ]),
  );
  const [rust] = buildHubs(list, details);

  it("titles and paths", () => {
    expect(hubHeading(rust!.summary)).toBe(
      "Rust project architecture examples",
    );
    expect(hubTitle(rust!.summary, 1)).toBe(
      `Rust project architecture examples: ${HUB_MIN_REPOSITORIES} diagrams`,
    );
    expect(hubPath("rust")).toBe("/architecture-examples/rust");
    expect(hubPath("rust", 3)).toBe("/architecture-examples/rust/3");
  });

  it("states only computed numbers", () => {
    const text = hubFindings(rust!.summary).join(" ");
    expect(text).toContain(
      `Across the ${HUB_MIN_REPOSITORIES} most-starred Rust projects here, the median diagram has 12 components. 100% draw a data store (most often SQLite), 100% have a command-line interface and 0% a web interface.`,
    );
    expect(text).toContain("100% are split into workspace packages");
    expect(hubFindings({ ...rust!.summary, patterns: null })).toEqual([]);
  });
});
