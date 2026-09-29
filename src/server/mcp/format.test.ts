import { describe, expect, it } from "vitest";

import type { VideoArtifact } from "~/features/explainer/types";
import {
  formatDiagram,
  formatMissingVideo,
  formatSearchResults,
  formatVideo,
  normalizeSearchQuery,
  parseRepositoryInput,
} from "./format";

describe("parseRepositoryInput", () => {
  it.each([
    ["fastapi/fastapi", "fastapi", "fastapi"],
    [" vercel/next.js ", "vercel", "next.js"],
    [
      "https://github.com/vercel/next.js/tree/canary/packages",
      "vercel",
      "next.js",
    ],
    [
      "github.com/ahmedkhaleel2004/gitdiagram",
      "ahmedkhaleel2004",
      "gitdiagram",
    ],
    ["www.github.com/a/b?tab=readme", "a", "b"],
    ["git@github.com:facebook/react.git", "facebook", "react"],
    ["https://gitdiagram.com/fastapi/fastapi", "fastapi", "fastapi"],
    ["gitdiagram.com/fastapi/fastapi/video", "fastapi", "fastapi"],
  ])("reads %s", (input, username, repo) => {
    expect(parseRepositoryInput(input)).toEqual({ username, repo });
  });

  it.each([
    "fastapi",
    "how does react work",
    "https://gitlab.com/a/b",
    "a/..",
    "-bad/repo",
    "",
  ])("rejects %s", (input) => {
    expect(parseRepositoryInput(input)).toBeNull();
  });
});

describe("normalizeSearchQuery", () => {
  it("turns URLs into owner/repo and keeps plain names", () => {
    expect(normalizeSearchQuery("https://github.com/vercel/next.js")).toBe(
      "vercel/next.js",
    );
    expect(normalizeSearchQuery("github.com/vercel")).toBe("vercel");
    expect(normalizeSearchQuery("  langchain ")).toBe("langchain");
  });
});

const BASE = {
  username: "Owner",
  repo: "Repo",
  stargazerCount: 1234,
  lastSuccessfulAt: "2026-09-01T00:00:00.000Z",
  explanation: "An app.",
  diagram: "flowchart TD\n  a --> b",
};

describe("formatDiagram", () => {
  it("links the lowercase page and lists groups, loose nodes and edges", () => {
    const text = formatDiagram(
      {
        ...BASE,
        graph: {
          groups: [{ id: "core", label: "Core", description: "The heart." }],
          nodes: [
            {
              id: "a",
              label: "API",
              type: "service",
              description: "Serves\nrequests.",
              groupId: "core",
              path: "src/api",
              shape: null,
            },
            {
              id: "b",
              label: "DB",
              type: "database",
              description: null,
              groupId: null,
              path: null,
              shape: "database",
            },
          ],
          edges: [
            {
              from: "a",
              to: "b",
              label: "queries",
              description: null,
              style: "dashed",
            },
          ],
        },
      },
      { hasVideo: true },
    );
    expect(text).toContain(
      "Interactive diagram: https://gitdiagram.com/owner/repo",
    );
    expect(text).toContain(
      "Narrated explainer video: https://gitdiagram.com/owner/repo/video",
    );
    expect(text).toContain("★ 1,234 · diagram generated 2026-09-01");
    expect(text).toContain(
      "### Core\nThe heart.\n- **API** (service) `src/api`: Serves requests.",
    );
    expect(text).toContain("### Outside the groups\n- **DB** (database)");
    expect(text).toContain("- API → DB: queries [dashed]");
    expect(text).toContain("```mermaid\nflowchart TD\n  a --> b\n```");
  });

  it("works for older artifacts without a graph or video", () => {
    const text = formatDiagram({ ...BASE, graph: null }, { hasVideo: false });
    expect(text).not.toContain("## Components");
    expect(text).not.toContain("/video");
    expect(text).toContain("```mermaid");
  });
});

describe("formatSearchResults", () => {
  it("says how to get a diagram when nothing matches", () => {
    expect(formatSearchResults("zzz", [], 0)).toContain(
      "get_repository_diagram",
    );
  });
});

describe("formatVideo", () => {
  it("gives the watch link, length and transcript", () => {
    const video = {
      createdAt: "2026-09-25T10:00:00.000Z",
      meta: { owner: "Owner", repo: "Repo" },
      timing: { DURATION: 95.4 },
      plan: {
        title: "How Repo works",
        beats: [
          { narration: "Repo is a tool." },
          { narration: " It  runs fast. " },
        ],
      },
    } as unknown as VideoArtifact;
    const text = formatVideo(video);
    expect(text).toContain("Watch: https://gitdiagram.com/owner/repo/video");
    expect(text).toContain("Length: 1:35 · made 2026-09-25");
    expect(text).toContain("Repo is a tool.\nIt runs fast.");
  });

  it("says when there is no video", () => {
    expect(formatMissingVideo({ username: "a", repo: "b" })).toContain(
      "no explainer video of a/b",
    );
  });
});
