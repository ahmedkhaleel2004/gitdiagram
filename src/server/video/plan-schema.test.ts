import { describe, expect, it } from "vitest";
import { clip, normalizeVideoPlan, VIDEO_PLAN_SCHEMA } from "./plan-schema";

const facts = {
  name: "demo",
  paths: ["src/app.ts", "src/router.ts", "README.md"],
  sourceText:
    'FILE "src/app.ts"\nexport function createApp() {\n  return new Router();\n}\nEND FILE',
};

const beat = (
  narration: string,
  scene: Record<string, unknown>,
  chapter = "Core",
) => ({
  chapter,
  narration,
  scene,
});

describe("explainer video plan", () => {
  it("clips on-screen text at a word boundary", () => {
    expect(clip("One tree: validate, inject, document", 30)).toBe(
      "One tree: validate, inject…",
    );
    expect(clip("short", 30)).toBe("short");
  });

  it("keeps real paths, repairs cues and appends a missing close", () => {
    const { plan, warnings } = normalizeVideoPlan(
      {
        title: "Demo",
        hook: "Routes in, responses out",
        idea: { teaser: "the idea", statement: "unused", emphasis: "x" },
        beats: [
          beat("Demo turns routes into responses.", {
            type: "hook",
            components: ["app", "router"],
          }),
          beat("The app starts here and the router decides.", {
            type: "tree",
            rows: [
              { path: "src/app.ts", note: "entry", cue: "app" },
              { path: "src/missing.ts", note: "invented", cue: "router" },
              { path: "src/router.ts", note: "routing", cue: "nowhere" },
            ],
          }),
        ],
        takeaway: [{ text: "Routes in", cue: "routes" }],
        startHere: { path: "src", files: ["app.ts"] },
        architecture: {
          groups: [],
          nodes: [
            { id: "app", label: "App", sub: "", group: "", kind: "box" },
            {
              id: "router",
              label: "Router",
              sub: "",
              group: "",
              kind: "robot",
            },
          ],
          edges: [
            { from: "app", to: "router", label: "" },
            { from: "app", to: "ghost", label: "" },
          ],
        },
      },
      facts,
    );
    const tree = plan.beats[1]!.scene as unknown as {
      rows: Array<{ path: string; cue: string }>;
    };
    expect(tree.rows.map((row) => row.path)).toEqual([
      "src/app.ts",
      "src/router.ts",
    ]);
    expect(tree.rows[1]!.cue).toBe("");
    expect(warnings).toContain(
      "dropped unknown path src/missing.ts (beat 2 tree)",
    );
    expect(warnings.some((w) => w.includes('cue "nowhere"'))).toBe(true);
    expect(plan.beats.at(-1)!.scene.type).toBe("close");
    // No idea beat, so the idea card is dropped rather than left dangling.
    expect(plan.idea).toBeNull();
    expect(plan.architecture.nodes[1]!.kind).toBe("box");
    expect(plan.architecture.edges).toHaveLength(1);
  });

  it("flags code that was not copied from the repository", () => {
    const { warnings } = normalizeVideoPlan(
      {
        beats: [
          beat("Hook.", { type: "hook", components: [] }),
          beat("The app builds a router.", {
            type: "code",
            path: "src/app.ts",
            lines: [
              "export function createApp() {",
              "  return makeSomethingUp();",
              "  const invented = true;",
            ],
            highlights: [{ line: 99, note: "entry", cue: "router" }],
          }),
          beat("Close.", { type: "close" }),
        ],
        takeaway: [],
        startHere: { path: "src", files: [] },
        architecture: { groups: [], nodes: [], edges: [] },
      },
      facts,
    );
    expect(warnings.some((w) => w.includes("not verbatim"))).toBe(true);
  });

  it("describes every scene type in the schema", () => {
    const beats = (
      VIDEO_PLAN_SCHEMA.properties as unknown as {
        beats: { items: { properties: { scene: { anyOf: unknown[] } } } };
      }
    ).beats;
    expect(beats.items.properties.scene.anyOf).toHaveLength(12);
  });
});
