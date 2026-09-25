import {
  SHOT_ACTIONS,
  SHOT_KINDS,
  type ShotAction,
  type ShotBeat,
  type ShotElement,
  type ShotKind,
  type ShotPlan,
} from "~/features/explainer/types";
import {
  clip,
  normalizeWord,
  writtenLine,
  type PlanRepositoryFacts,
} from "./text";

type JsonSchema = Record<string, unknown>;
const str: JsonSchema = { type: "string" };
const num: JsonSchema = { type: "number" };
const bool: JsonSchema = { type: "boolean" };
const arr = (items: JsonSchema): JsonSchema => ({ type: "array", items });

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
      story: {
        type: "string",
        description:
          "The whole narration as one flowing paragraph, written before the beats; the beats split it word for word.",
      },
      outro: str,
      beats: arr({
        type: "object",
        properties: { scene: str, narration: str, brief: str },
        required: ["scene", "narration", "brief"],
      }),
    },
    required: ["title", "story", "outro", "beats"],
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
              src: str,
              fit: str,
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
              do: { type: "string", enum: SHOT_ACTIONS },
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
  /** What the voice reads, the captions show and the cues match. */
  narration: string;
  brief: string;
}
export interface Script {
  title: string;
  outro: string;
  beats: ScriptBeat[];
}

// A web address in the narration: a scheme or "www.", or a bare host on a
// common web domain ("example.com", but not "Next.js").
const WEB_ADDRESS =
  /\b(?:https?:\/\/|www\.)[^\s]+|\b(?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|app|ai|co|xyz|me|sh|gg|ly|so|info|biz|site|online|link|top|click|us|uk|de|ru|cn|tk|tv|fm)\b(?:\/[^\s]*)?/gi;

function hostOf(address: string): string {
  return address
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#:]/)[0]!
    .replace(/[.,;!?)\]'"…]+$/, "");
}

/**
 * Repository text is untrusted, so a script may carry an address the README
 * planted. Sentences naming an address the repository never mentions are cut
 * (the rest of the line is kept, so the paid run still makes its film).
 */
function withoutStrangeAddresses(value: string, repository: string): string {
  const known = repository.toLowerCase();
  const strange = (sentence: string) =>
    (sentence.match(WEB_ADDRESS) ?? []).some((address) => {
      const host = hostOf(address);
      return !host || !known.includes(host);
    });
  if (!strange(value)) return value;
  const kept = value
    .split(/(?<=[.!?…])\s+/)
    .filter((sentence) => !strange(sentence))
    .join(" ");
  console.warn(
    JSON.stringify({ event: "video.script.address_removed", kept: !!kept }),
  );
  return kept;
}

/**
 * The director's script, cleaned. `repository` is the material the director
 * read; web addresses it does not contain never reach the voice or the screen.
 */
export function normalizeScript(
  raw: unknown,
  name: string,
  repository = "",
): Script {
  const input = rec(raw);
  const clean = (value: unknown) =>
    withoutStrangeAddresses(text(value), repository);
  const beats = list(input.beats)
    .slice(0, 22)
    .map((beat) => {
      const narration = clean(beat.narration);
      return {
        scene: clip(beat.scene, 24) || "s",
        narration: writtenLine(narration),
        brief: clip(beat.brief, 900),
      };
    })
    .filter((beat) => beat.narration);
  if (beats.length < 4) throw new Error("The script has too few beats.");
  return {
    title: clip(clean(input.title) || name, 28),
    outro: clip(clean(input.outro), 60),
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

const MIN_SIZE: Record<Exclude<ShotKind, "arrow">, [number, number]> = {
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
  image: [3, 2],
};

// The canvas an element may occupy: the top band (y < 0.95) belongs to the
// repository label.
const CANVAS = { left: 0.6, right: 15.4, top: 0.95, bottom: 8.6 };

/**
 * The one id rule for element ids, arrow ends and action targets: lowercase
 * snake_case, at most 32 characters. Names every object inherits (such as
 * "constructor") get a trailing underscore, so no id can reach a prototype.
 */
export function normalizeShotId(value: unknown): string {
  const id = text(value)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 32);
  return id in Object.prototype ? `${id}_` : id;
}

/** The one cue rule: the first word, normalized, if this beat speaks it. */
function cueWord(value: unknown, narration: string): string | null {
  const word = words(text(value))[0];
  if (!word) return "";
  return words(narration).includes(word) ? word : null;
}

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
  const kind = text(raw.kind) as ShotKind;
  if (!SHOT_KINDS.includes(kind)) return null;
  const id = normalizeShotId(raw.id) || kind;
  const at = cueWord(raw.at, narration);
  if (at === null)
    warnings.push(`cue "${text(raw.at)}" not in narration (${where})`);
  const base = { id, kind, at: at ?? "" };
  if (kind === "arrow")
    return {
      ...base,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      from: normalizeShotId(raw.from),
      to: normalizeShotId(raw.to),
      label: clip(raw.label, 18),
      dashed: Boolean(raw.dashed),
      flow: Boolean(raw.flow),
    };
  const [minW, minH] = MIN_SIZE[kind];
  const w = clamp(number(raw.w, minW), minW, CANVAS.right - CANVAS.left);
  const h = clamp(number(raw.h, minH), minH, CANVAS.bottom - CANVAS.top);
  const x = clamp(number(raw.x, 0.8), CANVAS.left, CANVAS.right - w);
  const y = clamp(number(raw.y, 1), CANVAS.top, CANVAS.bottom - h);
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
    case "file": {
      const path = resolvePath(facts, text(raw.path));
      if (!path) {
        // A file card claims the file exists; one the tree lacks is dropped.
        warnings.push(`dropped file ${text(raw.path)} not in repo (${where})`);
        return null;
      }
      element.path = displayPath(path);
      break;
    }
    case "tree": {
      const paths: string[] = [];
      const rowMap = new Map<number, number>();
      (Array.isArray(raw.paths) ? raw.paths : [])
        .slice(0, 10)
        .forEach((value, index) => {
          const path = resolvePath(facts, text(value));
          if (!path) {
            warnings.push(`dropped unknown path ${text(value)} (${where})`);
            return;
          }
          paths.push(displayPath(path));
          rowMap.set(index + 1, paths.length);
        });
      if (!paths.length) {
        warnings.push(`dropped tree ${id} with no known paths (${where})`);
        return null;
      }
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
    case "image":
      // Only a picture stored with the film; anything else is dropped.
      if (!facts.images?.includes(text(raw.src))) {
        warnings.push(`dropped unknown picture ${text(raw.src)} (${where})`);
        return null;
      }
      element.src = text(raw.src);
      element.fit = text(raw.fit) === "cover" ? "cover" : "contain";
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

function pathExists(facts: PlanRepositoryFacts, clean: string) {
  return (
    clean === "" ||
    facts.paths.some(
      (known) => known === clean || known.startsWith(`${clean}/`),
    )
  );
}

/**
 * The real path a designer meant, checked before anything is clipped. Designers
 * often shorten a deep path to its tail ("adapters/filters/Foo.java"): a tail
 * that ends exactly one real file or folder resolves to its full path, and one
 * that ends several stays as written (it still names real files).
 */
function resolvePath(facts: PlanRepositoryFacts, raw: string): string | null {
  const clean = raw
    .trim()
    .replace(/^\.?\//, "")
    .replace(/\/$/, "");
  if (!clean || clean.includes("..")) return null;
  if (pathExists(facts, clean)) return clean;
  const matches = new Set<string>();
  for (const known of facts.paths) {
    const at = `/${known}/`.indexOf(`/${clean}/`);
    if (at >= 0) matches.add(known.slice(0, at + clean.length));
    if (matches.size > 1) return clean;
  }
  return [...matches][0] ?? null;
}

const PATH_DISPLAY_LIMIT = 60;

/** Long paths lose their leading folders, never the file name. */
function displayPath(path: string): string {
  if (path.length <= PATH_DISPLAY_LIMIT) return path;
  const parts = path.split("/");
  let tail = parts.pop()!;
  while (
    parts.length &&
    parts.at(-1)!.length + tail.length + 3 <= PATH_DISPLAY_LIMIT
  )
    tail = `${parts.pop()}/${tail}`;
  return tail.length + 2 <= PATH_DISPLAY_LIMIT
    ? `…/${tail}`
    : `…${tail.slice(-(PATH_DISPLAY_LIMIT - 1))}`;
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
  if (!SHOT_ACTIONS.includes(kind)) return null;
  const at = cueWord(raw.at, narration);
  if (at === null)
    warnings.push(`action cue "${text(raw.at)}" not in narration (${where})`);
  const targets = (Array.isArray(raw.target) ? raw.target : [raw.target])
    .map(normalizeShotId)
    .filter(Boolean);
  const action: ShotAction = {
    do: kind,
    at: at ?? "",
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
  // A designer who reuses an id in a scene means the newest element by it, so
  // later arrows and actions naming it land there (it is stored as `id_2`).
  let aliases = new Map<string, string>();
  script.beats.forEach((beat, index) => {
    const where = `beat ${index}`;
    const first = index === 0 || script.beats[index - 1]!.scene !== beat.scene;
    if (first) {
      sceneIds = new Set();
      present = new Map();
      rowMaps = new Map();
      aliases = new Map();
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
      aliases.set(element.id, id);
      element.id = id;
      sceneIds.add(id);
      const rowMap = treeRowMaps.get(element);
      if (rowMap) rowMaps.set(id, rowMap);
      elements.push(element);
    }
    const resolve = (ref: unknown) => aliases.get(String(ref)) ?? String(ref);
    // Arrows join two elements (never another arrow) on screen by now; they
    // may be listed before the elements they join.
    const isEnd = (id: string) => {
      const end = present.get(id) ?? elements.find((e) => e.id === id);
      return Boolean(end) && end!.kind !== "arrow";
    };
    const kept = elements.filter((element) => {
      if (element.kind !== "arrow") return true;
      element.from = resolve(element.from);
      element.to = resolve(element.to);
      const ok =
        [element.from, element.to].every((end) => isEnd(String(end))) &&
        element.from !== element.to;
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
      const targets = (action.target as string[]).map(resolve).filter(
        (target) =>
          present.has(target) &&
          // Arrows are routed between their ends; they cannot be moved.
          !(action.do === "move" && present.get(target)!.kind === "arrow"),
      );
      if (action.do !== "reset" && !targets.length) {
        warnings.push(`dropped ${action.do} on a missing target (${where})`);
        continue;
      }
      action.target = targets;
      const rowMap = rowMaps.get(targets[0] ?? "");
      if (rowMap && Array.isArray(action.rows))
        action.rows = remapRows(action.rows as number[], rowMap);
      if (action.do === "move") {
        const moved = present.get(targets[0]!)!;
        // The whole element stays on the canvas where it lands.
        action.x = clamp(Number(action.x), CANVAS.left, CANVAS.right - moved.w);
        action.y = clamp(Number(action.y), CANVAS.top, CANVAS.bottom - moved.h);
        present.set(moved.id, {
          ...moved,
          x: Number(action.x),
          y: Number(action.y),
        });
      }
      actions.push(action);
      if (action.do === "exit")
        for (const target of targets) present.delete(target);
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
