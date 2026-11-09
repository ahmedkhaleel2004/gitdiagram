import { describe, expect, it } from "vitest";
import type { BrowseIndexEntry } from "./catalog";
import {
  buildRelatedShards,
  RELATED_SHARD_COUNT,
  relatedFromShard,
  relatedShardId,
  type RelatedDiagrams,
} from "./related";

function entry(
  key: string,
  stars: number | null,
  language?: string,
): BrowseIndexEntry {
  const [username, repo] = key.split("/") as [string, string];
  return {
    username,
    repo,
    lastSuccessfulAt: "2026-11-01T00:00:00Z",
    stargazerCount: stars,
    ...(language ? { language } : {}),
  };
}

function relatedOf(
  entries: BrowseIndexEntry[],
  key: string,
): RelatedDiagrams | null {
  const shards = buildRelatedShards(entries, "2026-11-09T00:00:00Z");
  return relatedFromShard(shards.get(relatedShardId(key)) ?? null, key);
}

const python = [
  entry("django/django", 91000, "Python"),
  entry("pallets/flask", 75000, "Python"),
  entry("pydantic/pydantic", 29000, "Python"),
  entry("fastapi/typer", 20000, "Python"),
  entry("fastapi/sqlmodel", 18000, "Python"),
  entry("encode/starlette", 12000, "Python"),
  entry("encode/uvicorn", 11000, "Python"),
  entry("small/one", 12, "Python"),
  entry("tiny/zero", 0, "Python"),
  entry("rust/lang", 100000, "Rust"),
  entry("no/language", 50000),
];

describe("buildRelatedShards", () => {
  it("links a repository to its language's neighbours by stars, most stars first", () => {
    expect(relatedOf(python, "fastapi/sqlmodel")).toEqual({
      language: "Python",
      repositories: [
        "pallets/flask",
        "pydantic/pydantic",
        "fastapi/typer",
        "encode/starlette",
        "encode/uvicorn",
      ],
    });
  });

  it("never links a repository to itself or to one with few stars", () => {
    for (const { username, repo } of python) {
      const related = relatedOf(python, `${username}/${repo}`);
      expect(related?.repositories ?? []).not.toContain(`${username}/${repo}`);
      expect(related?.repositories ?? []).not.toContain("tiny/zero");
    }
  });

  it("gives repositories under the star threshold links too", () => {
    expect(relatedOf(python, "tiny/zero")?.repositories).toHaveLength(5);
  });

  it("shows nothing without a language or with fewer than three related", () => {
    expect(relatedOf(python, "no/language")).toBeNull();
    expect(relatedOf(python, "rust/lang")).toBeNull();
    const three = [
      entry("a/a", 100, "Go"),
      entry("b/b", 90, "Go"),
      entry("c/c", 80, "Go"),
    ];
    expect(relatedOf(three, "a/a")).toBeNull();
    expect(
      relatedOf([...three, entry("d/d", 70, "Go")], "a/a")?.repositories,
    ).toEqual(["b/b", "c/c", "d/d"]);
  });

  it("puts every repository in a stable shard", () => {
    const id = relatedShardId("FastAPI/FastAPI");
    expect(id).toBe(relatedShardId("fastapi/fastapi"));
    expect(Number.parseInt(id, 16)).toBeLessThan(RELATED_SHARD_COUNT);
  });
});

describe("relatedFromShard", () => {
  it("drops anything that is not a repository name", () => {
    expect(
      relatedFromShard(
        {
          version: 1,
          updatedAt: "",
          repositories: {
            "a/a": {
              language: "Go",
              repositories: [
                "b/b",
                "javascript:alert(1)",
                "c/c",
                "../x",
                "a/..",
                "d/d",
              ],
            },
          },
        },
        "A/A",
      ),
    ).toEqual({ language: "Go", repositories: ["b/b", "c/c", "d/d"] });
    expect(relatedFromShard(null, "a/a")).toBeNull();
  });
});
