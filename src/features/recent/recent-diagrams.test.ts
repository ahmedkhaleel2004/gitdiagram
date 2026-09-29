import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_RECENT_DIAGRAMS,
  clearRecentDiagrams,
  readRecentDiagrams,
  recordRecentDiagram,
  useRecentDiagrams,
} from "./recent-diagrams";

const KEY = "gitdiagram-recent-diagrams";

afterEach(() => {
  localStorage.clear();
});

describe("recent diagrams", () => {
  it("keeps the newest first, lowercased and without repeats", () => {
    recordRecentDiagram({
      owner: "Acme",
      repo: "Demo",
      lastSuccessfulAt: "t1",
    });
    recordRecentDiagram({ owner: "fastapi", repo: "fastapi" });
    recordRecentDiagram({
      owner: "acme",
      repo: "demo",
      lastSuccessfulAt: "t2",
    });

    expect(
      readRecentDiagrams().map(({ owner, repo, lastSuccessfulAt }) => ({
        owner,
        repo,
        lastSuccessfulAt,
      })),
    ).toEqual([
      { owner: "acme", repo: "demo", lastSuccessfulAt: "t2" },
      { owner: "fastapi", repo: "fastapi", lastSuccessfulAt: null },
    ]);
  });

  it("keeps at most eight", () => {
    for (let index = 0; index < 12; index += 1)
      recordRecentDiagram({ owner: "acme", repo: `repo-${index}` });

    const entries = readRecentDiagrams();
    expect(entries).toHaveLength(MAX_RECENT_DIAGRAMS);
    expect(entries[0]?.repo).toBe("repo-11");
  });

  it("ignores names that could not be a repository path", () => {
    recordRecentDiagram({ owner: "../admin", repo: "x" });
    recordRecentDiagram({ owner: "acme", repo: ".." });
    expect(readRecentDiagrams()).toEqual([]);
  });

  it("drops tampered or corrupt storage", () => {
    localStorage.setItem(KEY, "not json");
    expect(readRecentDiagrams()).toEqual([]);

    localStorage.setItem(
      KEY,
      JSON.stringify([
        { owner: "acme", repo: "ok", lastSuccessfulAt: null, viewedAt: 1 },
        {
          owner: "javascript:alert(1)",
          repo: "x",
          lastSuccessfulAt: null,
          viewedAt: 1,
        },
        { owner: "acme", repo: "missing-time" },
      ]),
    );
    expect(readRecentDiagrams().map((entry) => entry.repo)).toEqual(["ok"]);
  });

  it("updates subscribers and clears", () => {
    const { result } = renderHook(() => useRecentDiagrams());
    expect(result.current).toEqual([]);

    act(() => recordRecentDiagram({ owner: "acme", repo: "demo" }));
    expect(result.current.map((entry) => entry.repo)).toEqual(["demo"]);
    // The same array while storage is unchanged.
    const first = result.current;
    act(() => window.dispatchEvent(new Event("gitdiagram:recent-diagrams")));
    expect(result.current).toBe(first);

    act(() => clearRecentDiagrams());
    expect(result.current).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
