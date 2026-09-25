import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/gitdiagram-video.json";
import { ENGINE_VERSION } from "./engine";
import {
  SHOT_ACTIONS,
  SHOT_KINDS,
  type ShotBeat,
  type ShotPlan,
  type ShotElement,
  type VideoTiming,
} from "./types";

// Smoke tests for the scene engine (public/video-engine): the real stage.js,
// shots.js and GSAP run in a JSDOM window and build a timeline that is then
// seeked like the player and the renderer do. JSDOM has no layout, canvas or
// fonts, so text is measured by length and sizes are not checked; what is
// checked is that plans build and elements appear, act and leave on time.

const ENGINE = "public/video-engine/";
const read = (name: string) => readFileSync(`${ENGINE}${name}`, "utf8");
const SOURCES = {
  gsap: read("assets/vendor/gsap.min.js"),
  stage: read("stage.js"),
  shots: read("shots.js"),
  html: read("stage.html"),
  css: read("engine.css"),
};

interface Gsap {
  getProperty(target: Element, property: string): number | string;
}
type StageWindow = JSDOM["window"] & {
  __renderSeek: (time: number) => void;
  gsap: Gsap;
};
interface Stage {
  window: StageWindow;
  duration: number;
  seek: (time: number) => void;
  node: (id: string) => HTMLElement;
  opacity: (node: Element) => number;
  captions: () => string;
}

const META = {
  owner: "acme",
  repo: "demo",
  url: "https://github.com/acme/demo",
  description: "",
  stars: 1,
  language: "TypeScript",
};

interface StageOptions {
  /** Runs in the stage window before any engine code (stubs, spies). */
  setup?: (window: StageWindow) => void;
  /** Called with each message the stage posts, before it resolves. */
  onMessage?: (data: { type?: string }) => void;
  /** Runs once the stage listens, before the player's own "load". */
  beforeLoad?: (window: StageWindow) => void;
}

async function openStage(
  spec: ShotPlan,
  timing: VideoTiming,
  options: StageOptions = {},
): Promise<Stage> {
  const dom = new JSDOM(SOURCES.html, {
    url: `https://gitdiagram.test/video-engine/stage.html?v=${ENGINE_VERSION}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const window = dom.window as StageWindow;
  const { document } = window;
  window.HTMLCanvasElement.prototype.getContext = (() => ({
    font: "",
    measureText: (text: string) => ({ width: text.length * 12 }),
  })) as never;
  Object.defineProperty(document, "fonts", {
    value: { load: () => Promise.resolve([]) },
  });
  // stage.js loads shots.js with a script tag; run it in place.
  const append = document.body.appendChild.bind(document.body);
  document.body.appendChild = (<T extends Node>(node: T): T => {
    if (node instanceof window.HTMLScriptElement) {
      window.eval(SOURCES.shots);
      return node;
    }
    return append(node);
  }) as typeof document.body.appendChild;
  options.setup?.(window);
  window.eval(SOURCES.gsap);
  window.eval(SOURCES.stage);

  const ready = new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The stage did not build.")),
      5_000,
    );
    window.addEventListener("message", (event: MessageEvent) => {
      const data = event.data as { type?: string; duration?: number };
      options.onMessage?.(data);
      if (data?.type === "ready") {
        clearTimeout(timer);
        resolve(Number(data.duration));
      } else if (data?.type === "error") {
        clearTimeout(timer);
        reject(new Error(JSON.stringify(data)));
      }
    });
  });
  const send = (data: unknown) =>
    window.dispatchEvent(
      new window.MessageEvent("message", {
        data,
        origin: window.location.origin,
        source: window as never,
      }),
    );
  options.beforeLoad?.(window);
  send({ type: "load", spec, meta: META, timing, captions: true });
  const duration = await ready;
  const stage: Stage = {
    window,
    duration,
    seek: (time) => window.__renderSeek(time),
    node: (id) => {
      const found = document.querySelector<HTMLElement>(`[data-id="${id}"]`);
      if (!found) throw new Error(`No element ${id}`);
      return found;
    },
    opacity: (node) => {
      const value = window.gsap.getProperty(node, "opacity");
      return Number(value);
    },
    captions: () => document.getElementById("captions")?.textContent ?? "",
  };
  return stage;
}

/** A timing where each beat's words are spoken one per `step` seconds. */
function timingFor(narrations: string[], step = 0.5): VideoTiming {
  let clock = 0.4;
  const beats = narrations.map((narration) => {
    const start = clock;
    const words = narration.split(/\s+/).map((word) => {
      const s = clock;
      clock += step;
      return {
        w: word.toLowerCase().replace(/[^a-z0-9.#/]/g, ""),
        s,
        e: s + step * 0.8,
      };
    });
    const end = clock - step * 0.2;
    clock += 0.1;
    return { start, end, words };
  });
  const end = beats.at(-1)!.end;
  return { DURATION: end + 3.5, SPEECH_END: end, beats };
}

const box = (
  id: string,
  x: number,
  y: number,
  extra: Partial<ShotElement> = {},
): ShotElement => ({
  id,
  kind: "box",
  x,
  y,
  w: 3,
  h: 1,
  at: "",
  label: id,
  sub: "",
  icon: "none",
  tone: "plain",
  ...extra,
});

const arrow = (
  id: string,
  from: string,
  to: string,
  extra: Partial<ShotElement> = {},
): ShotElement => ({
  id,
  kind: "arrow",
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  at: "",
  from,
  to,
  label: "",
  dashed: false,
  flow: false,
  ...extra,
});

function plan(beats: Array<Partial<ShotBeat> & { narration: string }>) {
  return {
    title: "Demo",
    outro: "Done",
    beats: beats.map((beat) => ({
      scene: "one",
      transition: "",
      elements: [],
      actions: [],
      ...beat,
    })),
  };
}

describe("video engine", () => {
  it("keeps the stage and engine.ts on one engine version", () => {
    const versions = [
      ...`${SOURCES.html}${SOURCES.css}`.matchAll(/\?v=(\d+)/g),
    ].map((match) => match[1]);
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) expect(version).toBe(ENGINE_VERSION);
  });

  it("versions every file the stage and its styles load", () => {
    // Assets are cached for a day: a new engine must not meet an old font,
    // texture or GSAP build.
    const references = [
      ...[...SOURCES.html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
        (match) => match[1]!,
      ),
      ...[...SOURCES.css.matchAll(/url\("?([^")]+)"?\)/g)].map(
        (match) => match[1]!,
      ),
    ];
    expect(references.length).toBeGreaterThan(5);
    for (const reference of references)
      expect(reference).toMatch(new RegExp(`\\?v=${ENGINE_VERSION}$`));
  });

  it("builds and plays a real production plan", async () => {
    const artifact = fixture as unknown as {
      plan: { title: string; outro: string; beats: ShotBeat[] };
      timing: VideoTiming;
    };
    const stage = await openStage(artifact.plan, artifact.timing);
    expect(stage.duration).toBeCloseTo(artifact.timing.DURATION, 1);
    for (let t = 0; t <= stage.duration; t += 0.25) stage.seek(t);
    // "Generate API" pops in on "architecture" in the third beat.
    const cue = artifact.timing.beats[2]!.words.find(
      (word) => word.w === "architecture",
    )!;
    stage.seek(cue.s - 0.3);
    expect(stage.opacity(stage.node("b_api"))).toBe(0);
    stage.seek(cue.s + 0.6);
    expect(stage.opacity(stage.node("b_api"))).toBe(1);
    expect(stage.captions()).toBe(artifact.plan.beats[2]!.narration);
  });

  it("draws every element kind and runs every action", async () => {
    const narration = "every kind appears and then every action runs here";
    const elements: ShotElement[] = [
      { ...box("h", 1, 1), kind: "heading", text: "A *real* title" },
      { ...box("t", 5, 1), kind: "text", text: "Some text", size: "m" },
      {
        ...box("c", 1, 2),
        kind: "code",
        w: 6,
        h: 3,
        title: "src/a.ts",
        lines: ["const constructor = 1;", "return constructor;"],
        focus: [1],
      },
      {
        ...box("term", 8, 2),
        kind: "terminal",
        w: 5,
        h: 2,
        title: "sh",
        lines: ["$ npm test", "ok"],
      },
      box("b", 1, 6),
      { ...box("chip", 5, 6), kind: "chip", text: "chip", h: 0.6 },
      { ...box("f", 9, 6), kind: "file", path: "src/app/page.tsx" },
      {
        ...box("tree", 13, 1),
        kind: "tree",
        w: 2,
        h: 2,
        paths: ["src/a.ts", "src/b.ts"],
        focus: [1],
      },
      {
        ...box("tab", 1, 7),
        kind: "table",
        columns: ["a", "b"],
        rows: [["1", "2"]],
      },
      {
        ...box("bars", 5, 7),
        kind: "bars",
        items: [{ label: "x", value: 3 }],
        unit: "ms",
      },
      { ...box("n", 9, 7), kind: "number", value: 12, label: "files" },
      { ...box("stamp", 13, 7), kind: "stamp", text: "OK", tone: "ok" },
      { ...box("br", 13, 4), kind: "browser", url: "example.test" },
      {
        ...box("req", 13, 5),
        kind: "request",
        method: "GET",
        url: "/x",
        status: 200,
        lines: ["{}"],
      },
      { ...box("l", 9, 4), kind: "list", items: ["one", "two"] },
      {
        ...box("svg", 9, 5),
        kind: "svg",
        viewBox: "0 0 10 10",
        shapes: [{ shape: "circle", cx: 5, cy: 5, r: 4, fill: "none" }],
      },
      { ...box("pic", 1, 7), kind: "image", src: "img1", fit: "contain" },
      arrow("wire", "b", "chip", { label: "calls" }),
    ];
    const act = (name: string, target: string[], extra = {}) => ({
      do: name,
      at: "",
      target,
      ...extra,
    });
    const actions = [
      act("highlight", ["c"], { lines: [2] }),
      act("dim", ["t"]),
      act("restore", ["t"]),
      act("strike", ["b"]),
      act("pulse", ["wire"]),
      act("shake", ["chip"]),
      act("check", ["wire"]),
      act("cross", ["f"]),
      act("replace", ["chip"], { text: "new chip" }),
      act("count", ["n"], { value: 40 }),
      act("move", ["stamp"], { x: 12, y: 7 }),
      act("type", ["term"], { line: "$ npm run build" }),
      act("flow", ["wire"]),
      act("scan", ["tree"]),
      act("focus", ["wire"]),
      act("reset", []),
      act("exit", ["h"]),
    ] as ShotBeat["actions"];
    expect(actions.map((action) => action.do).sort()).toEqual(
      [...SHOT_ACTIONS].sort(),
    );
    const stage = await openStage(
      {
        ...plan([
          { narration, elements },
          { narration: "and it all holds together", actions },
        ]),
        images: { img1: "/api/video/file?format=picture&id=img1" },
      },
      timingFor([narration, "and it all holds together"]),
    );
    for (const kind of SHOT_KINDS)
      expect(
        stage.window.document.querySelector(`[data-kind="${kind}"]`),
      ).not.toBeNull();
    for (let t = 0; t <= stage.duration; t += 0.1) stage.seek(t);
  });

  it("accepts ids that name object prototype members", async () => {
    const narration = "the constructor builds it";
    const stage = await openStage(
      plan([
        {
          narration,
          elements: [box("constructor", 1, 2), box("__proto__", 6, 2)],
          actions: [
            {
              do: "pulse",
              at: "builds",
              target: ["constructor", "__proto__"],
            },
          ],
        },
      ]),
      timingFor([narration]),
    );
    stage.seek(2);
    expect(stage.opacity(stage.node("constructor"))).toBe(1);
  });

  it("draws arrows listed before the elements they join, once both are up", async () => {
    const narration = "a client calls the server";
    const timing = timingFor([narration]);
    const stage = await openStage(
      plan([
        {
          narration,
          elements: [
            arrow("link", "client", "server", { at: "a" }),
            box("client", 1, 3, { at: "client" }),
            box("server", 9, 3, { at: "server" }),
          ],
        },
      ]),
      timing,
    );
    const link = stage.node("link");
    expect(link.querySelector("path")?.getAttribute("d")).toMatch(/^M/);
    const head = link.querySelectorAll("path")[1]!;
    const server = timing.beats[0]!.words.at(-1)!.s;
    stage.seek(server - 0.2);
    expect(stage.opacity(head)).toBe(0);
    stage.seek(server + 1);
    expect(stage.opacity(head)).toBe(1);
  });

  it("hides every part of an arrow, and an element's badges, on exit", async () => {
    const first = "the api calls the database";
    const second = "then both of them leave";
    const stage = await openStage(
      plan([
        {
          narration: first,
          elements: [
            box("api", 1, 3),
            box("db", 9, 3),
            arrow("wire", "api", "db", { label: "query", flow: true }),
          ],
          actions: [{ do: "check", at: "database", target: ["db"] }],
        },
        {
          narration: second,
          actions: [{ do: "exit", at: "leave", target: ["wire", "db"] }],
        },
      ]),
      timingFor([first, second]),
    );
    const document = stage.window.document;
    const label = [...document.querySelectorAll("div")].find(
      (node) => node.textContent === "query",
    )!;
    const badge = document.querySelector(".badge")!;
    // "flow": packets run along the arrow without a flow action.
    let ran = false;
    for (let t = 0; t < 5 && !ran; t += 0.05) {
      stage.seek(t);
      const packet = stage
        .node("wire")
        .parentElement!.querySelector("div > div[style*='border-radius: 50%']");
      ran = packet !== null && stage.opacity(packet) === 1;
    }
    expect(ran).toBe(true);
    stage.seek(4.6);
    expect(stage.opacity(label)).toBe(1);
    expect(stage.opacity(badge)).toBe(1);
    stage.seek(stage.duration - 3);
    expect(stage.opacity(stage.node("wire"))).toBe(0);
    expect(stage.opacity(label)).toBe(0);
    expect(stage.opacity(badge)).toBe(0);
  });

  it("cues the exact spoken word before a longer one that starts with it", async () => {
    const narration = "the database keeps rows and the data flows";
    const timing = timingFor([narration]);
    const stage = await openStage(
      plan([{ narration, elements: [box("data", 1, 3, { at: "data" })] }]),
      timing,
    );
    const words = timing.beats[0]!.words;
    const database = words.find((word) => word.w === "database")!.s;
    const data = words.find((word) => word.w === "data")!.s;
    stage.seek((database + data) / 2);
    expect(stage.opacity(stage.node("data"))).toBe(0);
    stage.seek(data + 0.6);
    expect(stage.opacity(stage.node("data"))).toBe(1);
  });

  it("frames an arrow's route when the camera focuses on it", async () => {
    const first = "the queue feeds the worker";
    const second = "look closely at that handoff";
    const stage = await openStage(
      plan([
        {
          narration: first,
          elements: [
            box("queue", 4, 4),
            box("worker", 9, 4),
            arrow("feed", "queue", "worker"),
          ],
        },
        {
          narration: second,
          actions: [{ do: "focus", at: "closely", target: ["feed"] }],
        },
      ]),
      timingFor([first, second]),
    );
    stage.seek(stage.duration - 3.2);
    const cam = stage.node("feed").parentElement!;
    const get = (property: string) =>
      Number(stage.window.gsap.getProperty(cam, property));
    const scale = get("scale");
    expect(scale).toBeGreaterThan(1);
    // The route runs from x 7 to 9 units at y 4.5: the view centres near it,
    // not on the canvas's top-left corner.
    expect((960 - get("x")) / scale).toBeGreaterThan(700);
    expect((540 - get("y")) / scale).toBeGreaterThan(400);
  });

  it("shakes a moved element where it stands", async () => {
    const narration = "the box moves over and then it shakes";
    const timing = timingFor([narration]);
    const stage = await openStage(
      plan([
        {
          narration,
          elements: [box("b", 1, 3)],
          actions: [
            { do: "move", at: "moves", target: ["b"], x: 5, y: 3 },
            { do: "shake", at: "shakes", target: ["b"] },
          ],
        },
      ]),
      timing,
    );
    const x = () => Number(stage.window.gsap.getProperty(stage.node("b"), "x"));
    // Mid-shake it swings about its new place, then settles there.
    stage.seek(timing.beats[0]!.words.at(-1)!.s + 0.02);
    expect(x()).toBeGreaterThan(480);
    expect(x()).toBeLessThanOrEqual(490);
    stage.seek(stage.duration - 3.2);
    expect(x()).toBe(480);
  });

  it("switches captions to the next beat as soon as it starts", async () => {
    const lines = ["first line here", "second line now"];
    const timing = timingFor(lines);
    const stage = await openStage(
      plan(lines.map((narration) => ({ narration }))),
      timing,
    );
    const next = timing.beats[1]!;
    stage.seek(next.start + 0.05);
    // The first beat ended under 0.35 s ago, but the new one has started.
    expect(timing.beats[0]!.end + 0.35).toBeGreaterThan(next.start + 0.05);
    expect(stage.captions()).toBe("second line now");
  });

  it("keeps arrows and their packets on the elements they join as those move", async () => {
    const first = "the api calls the worker";
    const second = "now the worker moves down and calls come here";
    const timing = timingFor([first, second]);
    const stage = await openStage(
      plan([
        {
          narration: first,
          elements: [
            box("api", 1, 3),
            box("worker", 9, 3),
            arrow("wire", "api", "worker", { label: "jobs" }),
          ],
        },
        {
          narration: second,
          actions: [
            { do: "move", at: "moves", target: ["worker"], x: 9, y: 6 },
            { do: "flow", at: "come", target: ["wire"] },
          ],
        },
      ]),
      timing,
    );
    const wire = stage.node("wire");
    const [path, head] = wire.querySelectorAll("path");
    const end = () => {
      const points = path!.getAttribute("d")!.match(/-?[\d.]+,-?[\d.]+/g)!;
      return points.at(-1)!.split(",").map(Number);
    };
    const label = [...stage.window.document.querySelectorAll("div")].find(
      (node) => node.textContent === "jobs",
    )!;
    const moves = timing.beats[1]!.words.find((word) => word.w === "moves")!.s;

    // Before the move: a straight wire into the worker's left side (y 420).
    stage.seek(moves - 0.3);
    expect(end()).toEqual([1070, 420]);
    const labelTop = label.style.top;
    // Mid-move the wire's end travels with the box.
    stage.seek(moves + 0.25);
    const [, midY] = end();
    expect(midY).toBeGreaterThan(420);
    expect(midY).toBeLessThan(780);
    // After it, the wire ends at the box's new place, head and label with it.
    stage.seek(moves + 1);
    expect(end()).toEqual([1070, 780]);
    expect(head!.getAttribute("transform")).toBe(
      "translate(1070,780) rotate(0)",
    );
    expect(label.style.top).not.toBe(labelTop);
    // Seeking back puts everything where it was.
    stage.seek(moves - 0.3);
    expect(end()).toEqual([1070, 420]);
    expect(label.style.top).toBe(labelTop);

    // Packets sent after the move ride the new route down to y 780.
    const packet = wire.parentElement!.querySelector<HTMLElement>(
      "div > div[style*='border-radius: 50%']",
    )!;
    let lowest = 0;
    for (let t = moves + 0.6; t < stage.duration; t += 0.05) {
      stage.seek(t);
      if (stage.opacity(packet) > 0)
        lowest = Math.max(
          lowest,
          Number(stage.window.gsap.getProperty(packet, "y")),
        );
    }
    expect(lowest).toBeCloseTo(780 - 420, 0);
  });

  it("sends packets already planned for a flowing arrow along its new route", async () => {
    const first = "api calls worker";
    const second = "then worker moves down while packets keep flowing along";
    const timing = timingFor([first, second]);
    const stage = await openStage(
      plan([
        {
          narration: first,
          elements: [
            box("api", 1, 3),
            box("worker", 9, 3),
            arrow("wire", "api", "worker", { flow: true }),
          ],
        },
        {
          narration: second,
          actions: [
            { do: "move", at: "moves", target: ["worker"], x: 9, y: 6 },
          ],
        },
      ]),
      timing,
    );
    const packet = stage
      .node("wire")
      .parentElement!.querySelector<HTMLElement>(
        "div > div[style*='border-radius: 50%']",
      )!;
    const moves = timing.beats[1]!.words.find((word) => word.w === "moves")!.s;
    const y = () => Number(stage.window.gsap.getProperty(packet, "y"));
    let before = 0;
    let during = 0;
    let after = 0;
    for (let t = 0; t < stage.duration; t += 0.05) {
      stage.seek(t);
      if (stage.opacity(packet) === 0) continue;
      if (t < moves - 0.1) before = Math.max(before, y());
      else if (t < moves + 0.1) continue;
      else if (t < moves + 0.5) during = Math.max(during, 1);
      else after = Math.max(after, y());
    }
    // Along the straight wire first, none while the box moves, then down
    // the new route to the box's new place.
    expect(before).toBe(0);
    expect(during).toBe(0);
    expect(after).toBeCloseTo(780 - 420, 0);
  });

  it("waits for every picture to decode before it is ready", async () => {
    const narration = "here is the logo and a broken one";
    const events: string[] = [];
    await openStage(
      {
        ...plan([
          {
            narration,
            elements: [
              { ...box("logo", 1, 2), kind: "image", src: "a", fit: "contain" },
              { ...box("gone", 8, 2), kind: "image", src: "b", fit: "cover" },
            ],
          },
        ]),
        images: { a: "/pictures/a.png", b: "/pictures/b.png" },
      },
      timingFor([narration]),
      {
        setup: (window) => {
          window.HTMLImageElement.prototype.decode = function (
            this: HTMLImageElement,
          ) {
            const src = this.getAttribute("src");
            return new Promise<void>((resolve, reject) =>
              setTimeout(() => {
                events.push(`decoded ${src}`);
                if (src?.endsWith("b.png")) reject(new Error("broken"));
                else resolve();
              }, 50),
            );
          };
        },
        onMessage: (data) => {
          if (data.type === "ready") events.push("ready");
        },
      },
    );
    // A picture that fails to decode does not hold the stage back forever.
    expect(events).toEqual([
      "decoded /pictures/a.png",
      "decoded /pictures/b.png",
      "ready",
    ]);
  });

  it("only draws pictures from this site", async () => {
    const narration = "three pictures and one of them is ours";
    const picture = (id: string, x: number): ShotElement => ({
      ...box(id, x, 2),
      kind: "image",
      src: id,
      fit: "contain",
    });
    const stage = await openStage(
      {
        ...plan([
          {
            narration,
            elements: [
              picture("ours", 1),
              picture("slashes", 5),
              picture("backslash", 9),
            ],
          },
        ]),
        images: {
          ours: "/api/video/file?format=picture&id=ours",
          slashes: "//evil.test/a.png",
          backslash: "/\\evil.test/a.png",
        },
      },
      timingFor([narration]),
    );
    const sources = [
      ...stage.window.document.querySelectorAll("#scenes img"),
    ].map((img) => img.getAttribute("src"));
    expect(sources).toEqual(["/api/video/file?format=picture&id=ours"]);
  });

  it("draws only plain shapes in an svg element", async () => {
    const narration = "a shape and some that are not";
    const stage = await openStage(
      plan([
        {
          narration,
          elements: [
            {
              ...box("art", 1, 2),
              kind: "svg",
              viewBox: "0 0 10 10",
              shapes: [
                { shape: "script" },
                { shape: "foreignObject", width: 10, height: 10 },
                { shape: "a" },
                { shape: "constructor" },
                { shape: "circle", cx: 5, cy: 5, r: 4, fill: "soft" },
              ],
            },
          ],
        },
      ]),
      timingFor([narration]),
    );
    const svg = stage.node("art").querySelector("svg")!;
    expect([...svg.children].map((node) => node.tagName)).toEqual(["circle"]);
  });

  it("shows model text as text in every element that carries it", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    const first = "every kind carries the text";
    const second = "then it changes again";
    const elements: ShotElement[] = [
      { ...box("h", 1, 0), kind: "heading", text: `*${evil}* ${evil}` },
      { ...box("t", 5, 0), kind: "text", text: evil, size: "m" },
      {
        ...box("c", 1, 1),
        kind: "code",
        w: 6,
        h: 3,
        title: evil,
        lines: [evil],
      },
      {
        ...box("term", 8, 1),
        kind: "terminal",
        w: 5,
        h: 2,
        title: evil,
        lines: [`$ ${evil}`, evil],
      },
      box("b", 1, 5, { label: evil, sub: evil }),
      { ...box("chip", 5, 5), kind: "chip", text: evil, h: 0.6 },
      { ...box("f", 9, 5), kind: "file", path: `src/${evil}` },
      {
        ...box("tree", 13, 0),
        kind: "tree",
        w: 2,
        h: 2,
        paths: [evil],
      },
      {
        ...box("tab", 1, 6),
        kind: "table",
        columns: [evil],
        rows: [[evil]],
      },
      {
        ...box("bars", 5, 6),
        kind: "bars",
        items: [{ label: evil, value: 3 }],
        unit: evil,
      },
      {
        ...box("n", 9, 6),
        kind: "number",
        value: 12,
        label: evil,
        prefix: evil,
        suffix: evil,
      },
      { ...box("stamp", 13, 6), kind: "stamp", text: evil, tone: "ok" },
      { ...box("br", 13, 3), kind: "browser", url: evil },
      {
        ...box("req", 13, 4),
        kind: "request",
        method: evil,
        url: evil,
        status: evil,
        lines: [evil],
      },
      { ...box("l", 9, 3), kind: "list", items: [evil] },
      arrow("wire", "b", "chip", { label: evil }),
    ];
    const stage = await openStage(
      {
        ...plan([
          { narration: first, elements },
          {
            narration: second,
            actions: [
              { do: "replace", at: "changes", target: ["chip"], text: evil },
              { do: "replace", at: "changes", target: ["h"], text: evil },
              { do: "type", at: "again", target: ["term"], line: evil },
            ],
          },
        ]),
        title: evil,
        outro: evil,
      },
      timingFor([first, second]),
    );
    for (let t = 0; t <= stage.duration; t += 0.5) stage.seek(t);
    const { document } = stage.window;
    expect(document.querySelectorAll("img")).toHaveLength(0);
    expect(document.querySelectorAll("[onerror]")).toHaveLength(0);
    const shown = document.getElementById("scenes")!.textContent!;
    // Each element keeps the markup as visible characters.
    expect(shown.split(evil.slice(0, 8)).length - 1).toBeGreaterThan(20);
  });

  it("ignores messages from other origins and other windows", async () => {
    const narration = "only the player may drive the stage";
    const timing = timingFor([narration]);
    const foreign = plan([{ narration, elements: [box("evil", 1, 2)] }]);
    const stage = await openStage(
      plan([{ narration, elements: [box("real", 1, 2)] }]),
      timing,
      {
        beforeLoad: (window) => {
          const load = { type: "load", spec: foreign, meta: META, timing };
          window.dispatchEvent(
            new window.MessageEvent("message", {
              data: load,
              origin: "https://evil.test",
              source: window as never,
            }),
          );
          window.dispatchEvent(
            new window.MessageEvent("message", {
              data: load,
              origin: window.location.origin,
              source: null,
            }),
          );
        },
      },
    );
    const { document } = stage.window;
    expect(document.querySelector('[data-id="evil"]')).toBeNull();
    expect(stage.node("real")).toBeTruthy();

    stage.seek(1);
    const hair = document.querySelector<HTMLElement>("#rail > div")!;
    const at = Number(stage.window.gsap.getProperty(hair, "scaleX"));
    for (const [origin, source] of [
      ["https://evil.test", stage.window],
      [stage.window.location.origin, null],
    ] as const)
      stage.window.dispatchEvent(
        new stage.window.MessageEvent("message", {
          data: { type: "seek", time: 3 },
          origin,
          source: source as never,
        }),
      );
    expect(Number(stage.window.gsap.getProperty(hair, "scaleX"))).toBe(at);
  });
});
