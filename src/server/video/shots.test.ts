import { describe, expect, it } from "vitest";
import { normalizeScript, normalizeShots, scriptWordCount } from "./shots";
import { clip } from "./text";

const facts = {
  name: "demo",
  paths: ["src/app.ts", "src/router.ts", "README.md"],
  sourceText:
    'FILE "src/app.ts"\nexport function createApp() {\n  return new Router();\n}\nEND FILE',
};

const script = normalizeScript(
  {
    title: "Demo",
    outro: "Routes in, *responses* out",
    beats: [
      {
        scene: "open",
        narration: "One function becomes a whole server.",
        brief: "",
      },
      {
        scene: "open",
        narration: "The router matches every request.",
        brief: "",
      },
      { scene: "core", narration: "Handlers run inside a stack.", brief: "" },
      { scene: "core", narration: "Errors come back as responses.", brief: "" },
    ],
  },
  "demo",
);

describe("explainer shots", () => {
  it("clips on-screen text at a word boundary", () => {
    expect(clip("One tree: validate, inject, document", 30)).toBe(
      "One tree: validate, inject…",
    );
  });

  it("keeps scene state across beats and drops what points at nothing", () => {
    const { plan, warnings } = normalizeShots(
      script,
      new Map([
        [
          0,
          {
            transition: "zoom",
            elements: [
              {
                id: "App",
                kind: "box",
                x: -3,
                y: 20,
                w: 3,
                h: 1,
                label: "createApp",
                at: "function",
              },
              {
                id: "tree",
                kind: "tree",
                x: 9,
                y: 1,
                w: 5,
                h: 3,
                paths: ["src/app.ts", "src/nope.ts"],
              },
              { id: "bad", kind: "hologram", x: 1, y: 1, w: 1, h: 1 },
            ],
            actions: [{ do: "pulse", target: "app", at: "server" }],
          },
        ],
        [
          1,
          {
            elements: [
              {
                id: "router",
                kind: "box",
                x: 6,
                y: 5,
                w: 3,
                h: 1,
                label: "Router",
              },
              {
                id: "a1",
                kind: "arrow",
                from: "app",
                to: "router",
                flow: true,
              },
              { id: "a2", kind: "arrow", from: "app", to: "ghost" },
            ],
            actions: [
              { do: "flow", target: "a1", at: "matches" },
              { do: "highlight", target: "missing" },
            ],
          },
        ],
        [
          2,
          {
            elements: [
              {
                id: "src",
                kind: "code",
                x: 1,
                y: 1,
                w: 8,
                h: 3,
                title: "src/app.ts",
                lines: [
                  "export function createApp() {",
                  "  return new MadeUp();",
                  "  const invented = 1;",
                ],
              },
            ],
            actions: [{ do: "highlight", target: "app" }],
          },
        ],
      ]),
      facts,
    );
    const [first, second, third, fourth] = plan.beats;
    const app = first!.elements[0]!;
    // Clamped onto the canvas.
    expect(app.x).toBeGreaterThanOrEqual(0.6);
    expect(app.y + app.h).toBeLessThanOrEqual(8.6);
    expect(app.at).toBe("function");
    expect(first!.transition).toBe("zoom");
    expect(first!.elements.map((e) => e.kind)).toEqual(["box", "tree"]);
    expect(first!.elements[1]!.paths as string[]).toEqual(["src/app.ts"]);
    expect(second!.elements.map((e) => e.id)).toEqual(["router", "a1"]);
    expect(second!.actions.map((a) => a.do)).toEqual(["flow"]);
    // A new scene forgets the old one's elements.
    expect(third!.actions).toHaveLength(0);
    expect(third!.elements[0]!.title).toBe("src/app.ts · simplified");
    expect(fourth!.elements).toHaveLength(0);
    expect(warnings).toEqual(
      expect.arrayContaining([
        "dropped unknown path src/nope.ts (beat 0)",
        "dropped arrow a2 with a missing end (beat 1)",
        "no shot designed for beat 3",
      ]),
    );
  });

  it("strips everything but geometry from custom illustrations", () => {
    const { plan } = normalizeShots(
      script,
      new Map([
        [
          0,
          {
            elements: [
              {
                id: "art",
                kind: "svg",
                x: 1,
                y: 1,
                w: 3,
                h: 3,
                viewBox: "0 0 100 100",
                shapes: [
                  {
                    shape: "path",
                    d: "M0 0 L10 10",
                    fill: "accent",
                    onclick: "alert(1)",
                  },
                  { shape: "script", d: "M0 0" },
                  { shape: "path", d: "javascript:alert(1)" },
                ],
              },
            ],
            actions: [],
          },
        ],
      ]),
      facts,
    );
    const shapes = plan.beats[0]!.elements[0]!.shapes as Array<
      Record<string, unknown>
    >;
    expect(shapes).toHaveLength(2);
    expect(shapes[0]).toEqual({
      shape: "path",
      d: "M0 0 L10 10",
      fill: "accent",
      stroke: "ink",
    });
    expect(shapes[1]!.d).toBeUndefined();
  });

  it("requires a real script", () => {
    expect(() => normalizeScript({ beats: [] }, "demo")).toThrow();
  });
  it("keeps tree highlights on the same paths after unknown ones are dropped", () => {
    const { plan } = normalizeShots(
      script,
      new Map([
        [
          0,
          {
            elements: [
              {
                id: "files",
                kind: "tree",
                x: 1,
                y: 1,
                w: 6,
                h: 4,
                paths: ["src/app.ts", "tests/fake.ts", "src/router.ts"],
                focus: [2, 3],
              },
            ],
          },
        ],
        [
          1,
          {
            actions: [
              { at: "router", do: "highlight", target: "files", rows: [1, 3] },
            ],
          },
        ],
      ]),
      facts,
    );
    const tree = plan.beats[0]!.elements[0]!;
    expect(tree.paths).toEqual(["src/app.ts", "src/router.ts"]);
    expect(tree.focus).toEqual([2]);
    expect(plan.beats[1]!.actions[0]!.rows).toEqual([1, 2]);
  });

  it("counts the narration words that set the film's length", () => {
    expect(scriptWordCount(script)).toBe(21);
  });
});
