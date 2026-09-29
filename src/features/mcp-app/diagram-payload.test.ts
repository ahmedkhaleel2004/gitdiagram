import { describe, expect, it } from "vitest";

import {
  DIAGRAM_META_KEY,
  isOpenableUrl,
  readDiagramPayload,
} from "./diagram-payload";

const FOUND = {
  status: "found",
  repository: "fastapi/fastapi",
  diagramUrl: "https://gitdiagram.com/fastapi/fastapi",
  githubUrl: "https://github.com/fastapi/fastapi",
  stars: 102536,
  mermaid: 'flowchart TD\n  a["App"]',
};

const result = (payload: unknown) => ({
  content: [],
  _meta: { [DIAGRAM_META_KEY]: payload },
});

describe("readDiagramPayload", () => {
  it("reads a stored diagram", () => {
    expect(readDiagramPayload(result(FOUND))).toEqual(FOUND);
  });

  it("reads a missing diagram without Mermaid", () => {
    expect(
      readDiagramPayload(
        result({ ...FOUND, status: "missing", stars: null, mermaid: null }),
      ),
    ).toEqual({ ...FOUND, status: "missing", stars: null, mermaid: null });
  });

  it("rejects anything malformed", () => {
    expect(readDiagramPayload(null)).toBeNull();
    expect(readDiagramPayload({ content: [] })).toBeNull();
    expect(readDiagramPayload(result("x"))).toBeNull();
    expect(readDiagramPayload(result({ ...FOUND, status: "ok" }))).toBeNull();
    expect(readDiagramPayload(result({ ...FOUND, mermaid: " " }))).toBeNull();
    expect(
      readDiagramPayload(result({ ...FOUND, repository: "a/b/c" })),
    ).toBeNull();
    expect(
      readDiagramPayload(
        result({ ...FOUND, diagramUrl: "javascript:alert(1)" }),
      ),
    ).toBeNull();
    expect(
      readDiagramPayload(
        result({ ...FOUND, githubUrl: "https://evil.example/fastapi" }),
      ),
    ).toBeNull();
  });

  it("drops a nonsensical star count", () => {
    expect(readDiagramPayload(result({ ...FOUND, stars: -1 }))?.stars).toBe(
      null,
    );
    expect(readDiagramPayload(result({ ...FOUND, stars: "9" }))?.stars).toBe(
      null,
    );
  });
});

describe("isOpenableUrl", () => {
  it("opens only https GitHub and GitDiagram links", () => {
    expect(isOpenableUrl("https://github.com/a/b/blob/main/x.ts")).toBe(true);
    expect(isOpenableUrl("https://gitdiagram.com/a/b")).toBe(true);
    expect(isOpenableUrl("http://github.com/a/b")).toBe(false);
    expect(isOpenableUrl("https://github.com.evil.example/a")).toBe(false);
    expect(isOpenableUrl("https://user:pass@github.com/a")).toBe(false);
    expect(isOpenableUrl("javascript:alert(1)")).toBe(false);
    expect(isOpenableUrl(42)).toBe(false);
  });
});
