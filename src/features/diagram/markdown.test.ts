import { describe, expect, it } from "vitest";
import { missingDiagramMarkdown, repositoryMarkdown } from "./markdown";
import type { DiagramReadout } from "./readout";

const readout: DiagramReadout = {
  explanation: "## Overview\nDemo serves an API.",
  groups: [
    {
      id: "backend",
      label: "Backend",
      description: "Server side",
      components: [
        {
          id: "api",
          label: "API",
          type: "service",
          description: "Answers requests",
          path: "api/server.py",
          href: "https://github.com/acme/demo/blob/main/api/server.py",
        },
        {
          id: "user",
          label: "User",
          type: "component",
          description: null,
          path: null,
          href: null,
        },
      ],
    },
  ],
  connections: [
    {
      from: "User",
      to: "API",
      label: "calls",
      description: "Over HTTPS",
      evidencePath: "src/client.ts",
    },
  ],
  componentCount: 2,
  lastSuccessfulAt: "2026-09-19T12:00:00Z",
};

describe("repositoryMarkdown", () => {
  it("holds the overview, Mermaid, components and connections", () => {
    const markdown = repositoryMarkdown({
      owner: "acme",
      repo: "demo",
      diagram: "flowchart TD\n  A --> B",
      readout,
      videoUrl: "https://gitdiagram.com/acme/demo/video",
    });

    expect(markdown).toContain("# acme/demo architecture");
    expect(markdown).toContain("(last updated 2026-09-19)");
    expect(markdown).toContain(
      "- Interactive diagram: https://gitdiagram.com/acme/demo",
    );
    expect(markdown).toContain("- Repository: https://github.com/acme/demo");
    expect(markdown).toContain(
      "- Video tour (about a minute): https://gitdiagram.com/acme/demo/video",
    );
    expect(markdown).toContain(
      "## Overview\n\n#### Overview\nDemo serves an API.",
    );
    expect(markdown).toContain("```mermaid\nflowchart TD\n  A --> B\n```");
    expect(markdown).toContain(
      "- [API](https://github.com/acme/demo/blob/main/api/server.py): service · Answers requests · `api/server.py`",
    );
    expect(markdown).toContain("- **User**\n");
    expect(markdown).toContain(
      "- User → API: calls · Over HTTPS (evidence: `src/client.ts`)",
    );
    expect(markdown.endsWith("\n")).toBe(true);
  });

  it("leaves out the video line without a video, and never ends a fence early", () => {
    const markdown = repositoryMarkdown({
      owner: "acme",
      repo: "demo",
      diagram: 'flowchart TD\n  A["```"]',
      readout,
    });
    expect(markdown).not.toContain("Video tour");
    expect(markdown).toContain('````mermaid\nflowchart TD\n  A["```"]\n````');
  });
});

describe("missingDiagramMarkdown", () => {
  it("tells the agent how to make one", () => {
    const markdown = missingDiagramMarkdown("acme", "demo");
    expect(markdown).toContain("no stored diagram of acme/demo yet");
    expect(markdown).toContain("open https://gitdiagram.com/acme/demo");
  });
});
