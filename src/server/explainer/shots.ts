import type {
  ShotAction,
  ShotBeat,
  ShotElement,
  ShotPlan,
} from "~/features/explainer/types";
import { clip, normalizeWord, type PlanRepositoryFacts } from "./text";

type JsonSchema = Record<string, unknown>;
const str: JsonSchema = { type: "string" };
const num: JsonSchema = { type: "number" };
const bool: JsonSchema = { type: "boolean" };
const arr = (items: JsonSchema): JsonSchema => ({ type: "array", items });

const SHOT_KINDS = [
  "heading",
  "text",
  "code",
  "terminal",
  "box",
  "chip",
  "file",
  "tree",
  "table",
  "bars",
  "number",
  "stamp",
  "browser",
  "request",
  "list",
  "svg",
  "arrow",
] as const;
const ACTIONS = [
  "highlight",
  "dim",
  "restore",
  "exit",
  "strike",
  "pulse",
  "shake",
  "check",
  "cross",
  "replace",
  "count",
  "move",
  "type",
  "flow",
  "scan",
  "focus",
  "reset",
] as const;
const TONES = ["plain", "accent", "soft", "ok", "bad", "ghost"];
const ICONS = [
  "server",
  "database",
  "user",
  "file",
  "folder",
  "globe",
  "lock",
  "bolt",
  "clock",
  "queue",
  "cpu",
  "cloud",
  "key",
  "gear",
  "package",
  "browser",
  "terminal",
  "shield",
  "cache",
  "none",
];
const TRANSITIONS = ["slide", "push", "zoom", "cut"];

// Both roles get both tools so the cached prefix (tools → system → repo) is shared.
export const SCRIPT_TOOL = {
  name: "write_script",
  description: "DIRECTOR only: submit the film's script.",
  input_schema: {
    type: "object",
    properties: {
      title: str,
      outro: str,
      beats: arr({
        type: "object",
        properties: { scene: str, narration: str, brief: str },
        required: ["scene", "narration", "brief"],
      }),
    },
    required: ["title", "outro", "beats"],
  },
};

export const SHOTS_TOOL = {
  name: "write_shots",
  description:
    "DESIGNER only: submit the exact shots for the beats you were assigned.",
  input_schema: {
    type: "object",
    properties: {
      shots: arr({
        type: "object",
        properties: {
          beat: { type: "integer" },
          transition: { type: "string", enum: TRANSITIONS },
          elements: arr({
            type: "object",
            properties: {
              id: str,
              kind: { type: "string", enum: SHOT_KINDS },
              x: num,
              y: num,
              w: num,
              h: num,
              at: str,
              text: str,
              size: str,
              tone: str,
              mono: bool,
              title: str,
              lines: arr(str),
              focus: arr({ type: "integer" }),
              label: str,
              sub: str,
              icon: str,
              path: str,
              paths: arr(str),
              columns: arr(str),
              rows: arr(arr(str)),
              items: { type: "array" },
              unit: str,
              value: num,
              prefix: str,
              suffix: str,
              url: str,
              method: str,
              status: { type: ["integer", "null"] },
              viewBox: str,
              shapes: arr({ type: "object" }),
              from: str,
              to: str,
              dashed: bool,
              flow: bool,
            },
            required: ["id", "kind"],
          }),
          actions: arr({
            type: "object",
            properties: {
              at: str,
              do: { type: "string", enum: ACTIONS },
              target: {},
              lines: arr({ type: "integer" }),
              rows: arr({ type: "integer" }),
              text: str,
              value: num,
              x: num,
              y: num,
              line: str,
            },
            required: ["do"],
          }),
        },
        required: ["beat", "elements", "actions"],
      }),
    },
    required: ["shots"],
  },
};

type Json = Record<string, unknown>;
const rec = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
const list = (value: unknown): Json[] =>
  Array.isArray(value) ? value.map(rec) : [];
const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
const strings = (value: unknown, max: number, limit: number): string[] =>
  (Array.isArray(value) ? value : [])
    .slice(0, max)
    .map((item) => clip(item, limit));
const number = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));
const words = (sentence: string) =>
  sentence.split(/\s+/).map(normalizeWord).filter(Boolean);

interface ScriptBeat {
  scene: string;
  narration: string;
  brief: string;
}
export interface Script {
  title: string;
  outro: string;
  beats: ScriptBeat[];
}

export function normalizeScript(raw: unknown, name: string): Script {
  const input = rec(raw);
  const beats = list(input.beats)
    .slice(0, 22)
    .map((beat) => ({
      scene: clip(beat.scene, 24) || "s",
      narration: text(beat.narration).replace(/\s+/g, " ").trim(),
      brief: clip(beat.brief, 900),
    }))
    .filter((beat) => beat.narration);
  if (beats.length < 4) throw new Error("The script has too few beats.");
  return {
    title: clip(input.title || name, 28),
    outro: clip(input.outro, 60),
    beats,
  };
}

// At a natural speaking pace (about 2.1 words a second, with pauses) this
// keeps the film near a minute. Longer scripts go back to the director once.
export const SCRIPT_WORD_TARGET = 125;
export const SCRIPT_WORD_LIMIT = 140;

export function scriptWordCount(script: Script): number {
  return script.beats.reduce(
    (sum, beat) => sum + beat.narration.split(/\s+/).filter(Boolean).length,
    0,
  );
}

/** The script as designers see it: numbered beats with scene and brief. */
export function scriptForDesigners(script: Script): string {
  return script.beats
    .map(
      (beat, index) =>
        `${index}. [${beat.scene}] "${beat.narration}" — ${beat.brief}`,
    )
    .join("\n");
}

const MIN_SIZE: Record<string, [number, number]> = {
  heading: [2, 0.8],
  text: [1.5, 0.4],
  code: [5, 2.2],
  terminal: [4.5, 1.8],
  box: [2.2, 0.8],
  chip: [1.2, 0.5],
  file: [3, 0.8],
  tree: [4, 1.8],
  table: [4.5, 1.8],
  bars: [4, 1.8],
  number: [2.4, 1.6],
  stamp: [2.2, 0.8],
  browser: [5, 3],
  request: [5, 1.1],
  list: [3, 1.2],
  svg: [1.5, 1.5],
};

// A designer numbers tree rows before unknown paths are dropped; this maps each
// original row (1-based) to the row it became, so highlights land on the right one.
const treeRowMaps = new WeakMap<ShotElement, Map<number, number>>();

function remapRows(rows: number[], map: Map<number, number>): number[] {
  return rows.flatMap((row) => {
    const kept = map.get(row);
    return kept ? [kept] : [];
  });
}

function normalizeElement(
  raw: Json,
  narration: string,
  facts: PlanRepositoryFacts,
  warnings: string[],
  where: string,
): ShotElement | null {
  const kind = text(raw.kind) as ShotElement["kind"];
  if (!SHOT_KINDS.includes(kind)) return null;
  const id =
    text(raw.id)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .slice(0, 32) || kind;
  const cue = (value: unknown) => {
    const word = words(text(value))[0];
    if (!word) return "";
    if (words(narration).includes(word)) return word;
    warnings.push(`cue "${text(value)}" not in narration (${where})`);
    return "";
  };
  const base = { id, kind, at: cue(raw.at) };
  if (kind === "arrow")
    return {
      ...base,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      from: text(raw.from),
      to: text(raw.to),
      label: clip(raw.label, 18),
      dashed: Boolean(raw.dashed),
      flow: Boolean(raw.flow),
    };
  const [minW, minH] = MIN_SIZE[kind] ?? [1, 0.5];
  const w = clamp(number(raw.w, minW), minW, 14.8);
  const h = clamp(number(raw.h, minH), minH, 7.8);
  const x = clamp(number(raw.x, 0.8), 0.6, 15.4 - w);
  // The top band (y < 0.95) belongs to the repository label.
  const y = clamp(number(raw.y, 1), 0.95, 8.6 - h);
  const element: ShotElement = { ...base, x, y, w, h };
  const tone = TONES.includes(text(raw.tone)) ? text(raw.tone) : "plain";
  switch (kind) {
    case "heading":
      element.text = clip(raw.text, 60);
      break;
    case "text":
      element.text = clip(raw.text, 120);
      element.size = ["s", "m", "l"].includes(text(raw.size))
        ? text(raw.size)
        : "m";
      element.tone = ["ink", "muted", "accent"].includes(text(raw.tone))
        ? text(raw.tone)
        : "ink";
      element.mono = Boolean(raw.mono);
      break;
    case "code": {
      const lines = (Array.isArray(raw.lines) ? raw.lines : [])
        .slice(0, 16)
        .map((line) => {
          const clean = text(line).replace(/\t/g, "  ").replace(/\s+$/, "");
          return clean.length > 72 ? clean.slice(0, 71) + "…" : clean;
        });
      element.title = clip(raw.title, 60);
      element.lines = lines;
      element.focus = numbers(raw.focus, lines.length);
      const substantive = lines.filter((line) => line.trim().length > 6);
      const verbatim = substantive.filter((line) =>
        facts.sourceText.includes(line.trim().replace(/…$/, "")),
      );
      if (substantive.length && verbatim.length / substantive.length < 0.5) {
        warnings.push(
          `code not verbatim (${verbatim.length}/${substantive.length}) in ${where}`,
        );
        // Never pass paraphrase off as source: say so on the panel.
        element.title = `${clip(raw.title, 46) || "code"} · simplified`;
      }
      break;
    }
    case "terminal":
      element.title = clip(raw.title, 40);
      element.lines = strings(raw.lines, 10, 72);
      break;
    case "box":
      element.label = clip(raw.label, 28);
      element.sub = clip(raw.sub, 36);
      element.icon = ICONS.includes(text(raw.icon)) ? text(raw.icon) : "none";
      element.tone = tone;
      break;
    case "chip":
      element.text = clip(raw.text, 28);
      element.tone = tone;
      break;
    case "file":
      element.path = clip(raw.path, 60);
      if (!pathExists(facts, text(raw.path)))
        warnings.push(`file ${text(raw.path)} not in repo (${where})`);
      break;
    case "tree": {
      const paths: string[] = [];
      const rowMap = new Map<number, number>();
      strings(raw.paths, 10, 60).forEach((path, index) => {
        if (!pathExists(facts, path)) {
          warnings.push(`dropped unknown path ${path} (${where})`);
          return;
        }
        paths.push(path);
        rowMap.set(index + 1, paths.length);
      });
      element.paths = paths;
      element.focus = remapRows(numbers(raw.focus, 10), rowMap);
      treeRowMaps.set(element, rowMap);
      break;
    }
    case "table":
      element.columns = strings(raw.columns, 4, 24);
      element.rows = (Array.isArray(raw.rows) ? raw.rows : [])
        .slice(0, 6)
        .map((row) => strings(row, 4, 24));
      break;
    case "bars":
      element.items = list(raw.items)
        .slice(0, 6)
        .map((item) => ({
          label: clip(item.label, 20),
          value: number(item.value, 0),
        }));
      element.unit = clip(raw.unit, 6);
      break;
    case "number":
      element.value = number(raw.value, 0);
      element.prefix = clip(raw.prefix, 3);
      element.suffix = clip(raw.suffix, 6);
      element.label = clip(raw.label, 32);
      break;
    case "stamp":
      element.text = clip(raw.text, 14);
      element.tone = tone;
      break;
    case "browser":
      element.url = clip(raw.url, 60);
      break;
    case "request":
      element.method = clip(raw.method, 7).toUpperCase() || "GET";
      element.url = clip(raw.url, 60);
      element.status =
        raw.status === null || raw.status === undefined
          ? null
          : number(raw.status, 200);
      element.lines = strings(raw.lines, 6, 60);
      break;
    case "list":
      element.items = strings(raw.items, 5, 48);
      break;
    case "svg":
      element.viewBox = /^[\d.\s-]+$/.test(text(raw.viewBox))
        ? text(raw.viewBox)
        : "0 0 100 100";
      element.shapes = sanitizeShapes(raw.shapes);
      break;
  }
  return element;
}

function numbers(value: unknown, max: number): number[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => Math.trunc(Number(item)))
    .filter((n) => n >= 1 && n <= max)
    .slice(0, 8);
}

function pathExists(facts: PlanRepositoryFacts, path: string) {
  const clean = path.replace(/^\.?\//, "").replace(/\/$/, "");
  return (
    clean === "" ||
    facts.paths.some(
      (known) => known === clean || known.startsWith(`${clean}/`),
    )
  );
}

const SHAPES = ["path", "rect", "circle", "line", "polyline", "polygon"];
const PAINT = ["none", "paper", "card", "accent", "soft", "ink", "ok", "bad"];
const GEOMETRY = [
  "x",
  "y",
  "width",
  "height",
  "r",
  "cx",
  "cy",
  "x1",
  "y1",
  "x2",
  "y2",
  "rx",
];
/** Only plain geometry survives: no text, no links, no scripts, no styles. */
function sanitizeShapes(value: unknown) {
  return list(value)
    .slice(0, 24)
    .filter((shape) => SHAPES.includes(text(shape.shape)))
    .map((shape) => {
      const clean: Json = { shape: text(shape.shape) };
      for (const key of GEOMETRY)
        if (Number.isFinite(Number(shape[key])))
          clean[key] = Number(shape[key]);
      if (/^[MmLlHhVvCcSsQqTtAaZz\d.,\s-]+$/.test(text(shape.d)))
        clean.d = text(shape.d).slice(0, 600);
      if (/^[\d.,\s-]+$/.test(text(shape.points)))
        clean.points = text(shape.points).slice(0, 400);
      clean.fill = PAINT.includes(text(shape.fill)) ? text(shape.fill) : "none";
      clean.stroke = ["ink", "accent", "none"].includes(text(shape.stroke))
        ? text(shape.stroke)
        : "ink";
      return clean;
    });
}

function normalizeAction(
  raw: Json,
  narration: string,
  warnings: string[],
  where: string,
): ShotAction | null {
  const kind = text(raw.do) as ShotAction["do"];
  if (!ACTIONS.includes(kind)) return null;
  const word = words(text(raw.at))[0] ?? "";
  if (word && !words(narration).includes(word))
    warnings.push(`action cue "${text(raw.at)}" not in narration (${where})`);
  const targets = (Array.isArray(raw.target) ? raw.target : [raw.target])
    .map((target) =>
      text(target)
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_"),
    )
    .filter(Boolean);
  const action: ShotAction = {
    do: kind,
    at: word && words(narration).includes(word) ? word : "",
    target: targets,
  };
  if (Array.isArray(raw.lines)) action.lines = numbers(raw.lines, 99);
  if (Array.isArray(raw.rows)) action.rows = numbers(raw.rows, 99);
  if (kind === "replace") action.text = clip(raw.text, 60);
  if (kind === "count") action.value = number(raw.value, 0);
  if (kind === "move") {
    action.x = clamp(number(raw.x, 1), 0.6, 15);
    action.y = clamp(number(raw.y, 1), 0.95, 8.2);
  }
  if (kind === "type") action.line = clip(raw.line, 72);
  return action;
}

/** Merge the designers' shots into the script, then check it against the repository. */
export function normalizeShots(
  script: Script,
  designed: Map<number, Json>,
  facts: PlanRepositoryFacts,
): { plan: ShotPlan; warnings: string[] } {
  const warnings: string[] = [];
  const beats: ShotBeat[] = [];
  let sceneIds = new Set<string>();
  let present = new Map<string, ShotElement>();
  let rowMaps = new Map<string, Map<number, number>>();
  script.beats.forEach((beat, index) => {
    const where = `beat ${index}`;
    const first = index === 0 || script.beats[index - 1]!.scene !== beat.scene;
    if (first) {
      sceneIds = new Set();
      present = new Map();
      rowMaps = new Map();
    }
    const shot = designed.get(index);
    if (!shot) warnings.push(`no shot designed for ${where}`);
    const elements: ShotElement[] = [];
    for (const raw of list(shot?.elements)) {
      const element = normalizeElement(
        raw,
        beat.narration,
        facts,
        warnings,
        where,
      );
      if (!element) continue;
      let id = element.id;
      for (let n = 2; sceneIds.has(id); n++) id = `${element.id}_${n}`;
      element.id = id;
      sceneIds.add(id);
      const rowMap = treeRowMaps.get(element);
      if (rowMap) rowMaps.set(id, rowMap);
      elements.push(element);
    }
    // Arrows need both ends on screen by now.
    const kept = elements.filter((element) => {
      if (element.kind !== "arrow") return true;
      const ok =
        [element.from, element.to].every(
          (end) =>
            present.has(String(end)) ||
            elements.some((e) => e.id === end && e.kind !== "arrow"),
        ) && element.from !== element.to;
      if (!ok)
        warnings.push(
          `dropped arrow ${element.id} with a missing end (${where})`,
        );
      return ok;
    });
    for (const element of kept) present.set(element.id, element);
    const actions: ShotAction[] = [];
    for (const raw of list(shot?.actions)) {
      const action = normalizeAction(raw, beat.narration, warnings, where);
      if (!action) continue;
      const targets = (action.target as string[]).filter((target) =>
        present.has(target),
      );
      if (action.do !== "reset" && !targets.length) {
        warnings.push(`dropped ${action.do} on a missing target (${where})`);
        continue;
      }
      action.target = targets;
      const rowMap = rowMaps.get(targets[0] ?? "");
      if (rowMap && Array.isArray(action.rows))
        action.rows = remapRows(action.rows as number[], rowMap);
      actions.push(action);
      if (action.do === "exit")
        for (const target of targets) present.delete(target);
      if (action.do === "move") {
        const moved = present.get(targets[0]!);
        if (moved)
          present.set(moved.id, {
            ...moved,
            x: Number(action.x),
            y: Number(action.y),
          });
      }
    }
    warnOverlaps([...present.values()], warnings, where);
    beats.push({
      scene: beat.scene,
      narration: beat.narration,
      transition:
        first && TRANSITIONS.includes(text(shot?.transition))
          ? text(shot?.transition)
          : "",
      elements: kept,
      actions,
    });
  });
  return {
    plan: { title: script.title, outro: script.outro, beats },
    warnings,
  };
}

function warnOverlaps(
  elements: ShotElement[],
  warnings: string[],
  where: string,
) {
  const boxes = elements.filter(
    (element) => element.kind !== "arrow" && element.kind !== "browser",
  );
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      const inside = (p: ShotElement, q: ShotElement) =>
        p.x >= q.x &&
        p.y >= q.y &&
        p.x + p.w <= q.x + q.w &&
        p.y + p.h <= q.y + q.h;
      // Nesting (a layer inside a layer) is a deliberate composition, not a collision.
      if (inside(a, b) || inside(b, a)) continue;
      if (w > 0.05 && h > 0.05 && w * h > 0.15 * Math.min(a.w * a.h, b.w * b.h))
        warnings.push(`overlap ${a.id}/${b.id} (${where})`);
    }
}
