import { describe, expect, it } from "vitest";
import type { ShotElement } from "~/features/explainer/types";
import { parseLayout, solveLayout } from "./layout";
import { normalizeShots } from "./shots";

const el = (id: string, kind: string, fields: Record<string, unknown> = {}) =>
  ({ id, kind, at: "", x: 0, y: 0, w: 0, h: 0, ...fields }) as ShotElement;
const box = (id: string, label = "Router") => el(id, "box", { label, sub: "" });
const chip = (id: string, text = "ok") => el(id, "chip", { text });
const code = (id: string, lines = 5) =>
  el(id, "code", {
    title: "a.ts",
    lines: Array.from(
      { length: lines },
      (_, i) => `const value${i} = read(${i});`,
    ),
  });

function overlap(a: ShotElement, b: ShotElement) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0.01 && h > 0.01;
}
function expectClean(elements: ShotElement[], frames: string[] = []) {
  for (const e of elements) {
    expect(e.w).toBeGreaterThan(0.3);
    expect(e.h).toBeGreaterThan(0.3);
    // What the camera shows at its widest (camera.js), clear of the
    // repository label above and the captions below.
    expect(e.x).toBeGreaterThanOrEqual(1.2);
    expect(e.x + e.w).toBeLessThanOrEqual(14.8);
    expect(e.y).toBeGreaterThanOrEqual(1.3);
    expect(e.y + e.h).toBeLessThanOrEqual(7.2);
  }
  for (const a of elements)
    for (const b of elements)
      if (a !== b && !frames.includes(a.id) && !frames.includes(b.id))
        expect(overlap(a, b), `${a.id} over ${b.id}`).toBe(false);
}
const solve = (
  layout: unknown,
  elements: ShotElement[],
  arrows: ShotElement[] = [],
) =>
  solveLayout({ layout: parseLayout(layout), elements, arrows, actions: [] });

describe("parseLayout", () => {
  it("reads rows, columns, slots, windows and bare ids", () => {
    expect(
      parseLayout({ row: ["a", { col: [{ id: "b" }, { slot: ["c", "d"] }] }] }),
    ).toEqual({
      row: [
        { id: "a" },
        { col: [{ id: "b" }, { slot: [{ id: "c" }, { id: "d" }] }] },
      ],
    });
    expect(parseLayout({ id: "win", in: { col: ["a", "b"] } })).toEqual({
      id: "win",
      in: { col: [{ id: "a" }, { id: "b" }] },
    });
  });

  it("reads a layout sent as a JSON string, and refuses nonsense", () => {
    expect(parseLayout('{"row":["a","b"]}')).toEqual({
      row: [{ id: "a" }, { id: "b" }],
    });
    expect(parseLayout(undefined)).toBeNull();
    expect(parseLayout(7)).toBeNull();
    expect(parseLayout({ row: [] })).toBeNull();
    expect(parseLayout("{broken")).toBeNull();
  });

  it("bounds how deep and how wide a layout can go", () => {
    let deep: unknown = "x";
    for (let i = 0; i < 20; i++) deep = { row: [deep, "y"] };
    expect(JSON.stringify(parseLayout(deep)).length).toBeLessThan(400);
    const wide = parseLayout({
      row: Array.from({ length: 40 }, (_, i) => `e${i}`),
    });
    expect((wide as { row: unknown[] }).row).toHaveLength(8);
  });
});

describe("solveLayout", () => {
  it("lines a row up on one axis, with room for the arrows between", () => {
    const parts = [box("a"), box("b", "A much longer label"), box("c")];
    const arrows = [
      el("ab", "arrow", { from: "a", to: "b", label: "request" }),
      el("bc", "arrow", { from: "b", to: "c", label: "" }),
    ];
    solve({ row: ["a", "b", "c"] }, parts, arrows);
    expectClean(parts);
    const [a, b, c] = parts as [ShotElement, ShotElement, ShotElement];
    // One size, one centre line: the arrows between them run straight.
    expect(new Set(parts.map((p) => `${p.w}×${p.h}`)).size).toBe(1);
    expect(a.y).toBe(b.y);
    expect(b.y).toBe(c.y);
    expect(b.x - (a.x + a.w)).toBeGreaterThanOrEqual(1.1);
    expect(c.x - (b.x + b.w)).toBeGreaterThanOrEqual(1.1);
    // Centred in the frame.
    expect((a.x + c.x + c.w) / 2).toBeCloseTo(8, 1);
    expect(a.y + a.h / 2).toBeCloseTo(4.25, 1);
  });

  it("never lets anything overlap, however much a scene holds", () => {
    const parts = [
      code("src", 12),
      el("term", "terminal", { title: "sh", lines: ["$ run --all", "ok"] }),
      ...Array.from({ length: 6 }, (_, i) =>
        box(`b${i}`, `Service number ${i}`),
      ),
      ...Array.from({ length: 5 }, (_, i) => chip(`c${i}`, `flag-${i}`)),
      el("h", "heading", { text: "One thing after another, all at once" }),
    ];
    solve(
      {
        col: [
          "h",
          {
            row: [
              "src",
              { col: ["term", "b0", "b1", "b2"] },
              { col: ["b3", "b4", "b5"] },
            ],
          },
          { row: ["c0", "c1", "c2", "c3", "c4"] },
        ],
      },
      parts,
    );
    expectClean(parts);
  });

  it("draws a small scene big and a crowded one smaller", () => {
    const alone = [box("a")];
    solve("a", alone);
    const crowd = Array.from({ length: 16 }, (_, i) => box(`b${i}`));
    solve(
      {
        col: [0, 4, 8, 12].map((n) => ({
          row: [`b${n}`, `b${n + 1}`, `b${n + 2}`, `b${n + 3}`],
        })),
      },
      crowd,
    );
    expectClean(crowd);
    expect(alone[0]!.h).toBeGreaterThan(crowd[0]!.h);
  });

  it("turns a row of wide panels into a stack when that shows them bigger", () => {
    const wide = (id: string) =>
      el(id, "terminal", {
        title: "sh",
        lines: ["$ " + "x".repeat(58), "done"],
      });
    const parts = [wide("one"), wide("two")];
    solve({ row: ["one", "two"] }, parts);
    expectClean(parts);
    expect(parts[1]!.y).toBeGreaterThan(parts[0]!.y + parts[0]!.h);
    // A path of boxes stays the row it was drawn as.
    const path = [box("a"), box("b"), box("c")];
    solve({ row: ["a", "b", "c"] }, path);
    expect(path[0]!.y).toBe(path[2]!.y);
  });

  it("aligns rows of a column into a grid", () => {
    const parts = [
      chip("c1", "Microsoft"),
      box("b1", "ML"),
      chip("c2", "Uber"),
      box("b2", "Prediction server"),
    ];
    solve({ col: [{ row: ["c1", "b1"] }, { row: ["c2", "b2"] }] }, parts);
    expectClean(parts);
    const [c1, b1, c2, b2] = parts as ShotElement[];
    expect(b1!.x).toBe(b2!.x);
    expect(c1!.x + c1!.w / 2).toBeCloseTo(c2!.x + c2!.w / 2, 1);
  });

  it("frames a window around its content", () => {
    const parts = [
      el("win", "browser", { url: "example.test" }),
      box("a"),
      box("b"),
    ];
    solve({ id: "win", in: { row: ["a", "b"] } }, parts);
    expectClean(parts, ["win"]);
    const [win, a, b] = parts as ShotElement[];
    for (const inner of [a!, b!]) {
      expect(inner.x).toBeGreaterThan(win!.x);
      expect(inner.x + inner.w).toBeLessThan(win!.x + win!.w);
      // Below the window's bar.
      expect(inner.y).toBeGreaterThan(win!.y + 0.45);
      expect(inner.y + inner.h).toBeLessThan(win!.y + win!.h);
    }
  });

  it("gives the elements of a slot one place and reports them", () => {
    const parts = [
      el("req", "request", {
        method: "GET",
        url: "/items/42",
        status: null,
        lines: [],
      }),
      el("res", "request", {
        method: "GET",
        url: "/items/42",
        status: 200,
        lines: ['{"id": 42}'],
      }),
      chip("note"),
    ];
    const { slots } = solve({ row: [{ slot: ["req", "res"] }, "note"] }, parts);
    expect(slots).toEqual([[["req"], ["res"]]]);
    const [req, res] = parts as ShotElement[];
    expect(req!.x + req!.w / 2).toBeCloseTo(res!.x + res!.w / 2, 1);
    expect(overlap(req!, parts[2]!)).toBe(false);
    expect(overlap(res!, parts[2]!)).toBe(false);
  });

  it("places what the layout forgot, and ignores ids nothing has", () => {
    const parts = [box("a"), box("b"), chip("left_out")];
    solve({ row: ["a", "ghost", "b", "a"] }, parts);
    expectClean(parts);
    const none = [box("a"), chip("b")];
    solve(null, none);
    expectClean(none);
  });

  it("sizes a panel for the lines typed into it later, and a label for its replacement", () => {
    const short = [
      el("t", "terminal", { title: "sh", lines: ["$ go"] }),
      chip("c", "a"),
    ];
    solveLayout({
      layout: parseLayout({ col: ["t", "c"] }),
      elements: short,
      arrows: [],
      actions: [],
    });
    const grown = [
      el("t", "terminal", { title: "sh", lines: ["$ go"] }),
      chip("c", "a"),
    ];
    solveLayout({
      layout: parseLayout({ col: ["t", "c"] }),
      elements: grown,
      arrows: [],
      actions: [
        {
          do: "type",
          at: "",
          target: ["t"],
          line: "one more line of output here",
        },
        { do: "type", at: "", target: ["t"], line: "and another" },
        { do: "replace", at: "", target: ["c"], text: "a much longer value" },
      ],
    });
    expect(grown[0]!.h).toBeGreaterThan(short[0]!.h);
    expect(grown[1]!.w).toBeGreaterThan(short[1]!.w);
  });

  it("keeps a picture's shape", () => {
    const parts = [el("pic", "image", { src: "img1" })];
    solveLayout({
      layout: parseLayout("pic"),
      elements: parts,
      arrows: [],
      actions: [],
      pictures: { img1: { width: 1600, height: 800 } },
    });
    expectClean(parts);
    expect(parts[0]!.w / parts[0]!.h).toBeCloseTo(2, 0);
  });
});

describe("normalizeShots with a layout", () => {
  const facts = { name: "demo", paths: ["src/a.ts"], sourceText: "" };
  const script = {
    title: "T",
    outro: "O",
    beats: [
      { scene: "a", narration: "A request comes in", brief: "" },
      { scene: "a", narration: "and the answer goes out", brief: "" },
      { scene: "a", narration: "then everything starts over", brief: "" },
    ],
  };
  const layout = { row: [{ slot: ["req", "res"] }, { col: ["note", "pic"] }] };
  const designed = new Map<number, Record<string, unknown>>([
    [
      0,
      {
        layout,
        elements: [
          {
            id: "req",
            kind: "request",
            method: "GET",
            url: "/a",
            at: "request",
          },
          { id: "note", kind: "chip", text: "waiting" },
          { id: "pic", kind: "svg", viewBox: "0 0 10 10", shapes: [] },
        ],
        actions: [{ do: "move", target: "note", x: 3, y: 3 }],
      },
    ],
    [
      1,
      {
        layout,
        elements: [
          {
            id: "res",
            kind: "request",
            method: "GET",
            url: "/a",
            status: 200,
            at: "answer",
          },
        ],
        actions: [{ do: "pulse", target: "res", at: "out" }],
      },
    ],
    [
      2,
      {
        layout,
        elements: [
          { id: "again", kind: "heading", text: "Again", at: "starts" },
        ],
        actions: [{ do: "exit", target: ["res", "note"], at: "then" }],
      },
    ],
  ]);

  it("places every element, and makes slot-mates take turns", () => {
    const { plan, warnings } = normalizeShots(script, designed, facts);
    const all = plan.beats.flatMap((beat) => beat.elements);
    expect(all.map((e) => e.id)).toEqual(["req", "note", "res", "again"]);
    expect(warnings).toEqual([
      "dropped svg pic from a laid-out scene (beat 0)",
    ]);
    // No coordinates came from the designer, and "move" has none to go to.
    expect(plan.beats[0]!.actions).toEqual([]);
    expect(plan.beats[1]!.actions[0]).toEqual({
      do: "exit",
      at: "answer",
      target: ["req"],
    });
    const [req, note, res, again] = all as [
      ShotElement,
      ShotElement,
      ShotElement,
      ShotElement,
    ];
    expect(overlap(req, note)).toBe(false);
    expect(overlap(res, note)).toBe(false);
    // The last beat clears the screen, so its heading has the frame to itself.
    expect(again.x + again.w / 2).toBeCloseTo(8, 0);
    expect(again.y + again.h / 2).toBeCloseTo(4.25, 0);
  });

  it("lays a scene out even when the designer sent no layout and no coordinates", () => {
    const bare = new Map(
      [...designed].map(([beat, shot]) => [
        beat,
        { ...shot, layout: undefined },
      ]),
    );
    const { plan } = normalizeShots(script, bare, facts);
    const first = plan.beats.slice(0, 2).flatMap((beat) => beat.elements);
    for (const a of first)
      for (const b of first) if (a !== b) expect(overlap(a, b)).toBe(false);
  });

  it("keeps the coordinates of a film designed by hand", () => {
    const { plan } = normalizeShots(
      script,
      new Map([
        [
          0,
          {
            elements: [
              { id: "c", kind: "chip", text: "x", x: 2, y: 3, w: 3, h: 0.6 },
            ],
            actions: [],
          },
        ],
      ]),
      facts,
    );
    expect(plan.beats[0]!.elements[0]).toMatchObject({
      x: 2,
      y: 3,
      w: 3,
      h: 0.6,
    });
  });
});
