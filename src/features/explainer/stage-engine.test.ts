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

async function openStage(spec: ShotPlan, timing: VideoTiming): Promise<Stage> {
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
  window.eval(SOURCES.gsap);
  window.eval(SOURCES.stage);

  const ready = new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The stage did not build.")),
      5_000,
    );
    window.addEventListener("message", (event: MessageEvent) => {
      const data = event.data as { type?: string; duration?: number };
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
    const versions = [...SOURCES.html.matchAll(/\?v=(\d+)/g)].map(
      (match) => match[1],
    );
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) expect(version).toBe(ENGINE_VERSION);
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
});
