import type { ShotAction, ShotElement } from "~/features/explainer/types";

// Where a scene's elements sit. The designer says how they are arranged (rows
// and columns, a browser window around some of them, a slot two of them take
// turns in) and never writes a coordinate; this works out every position, so
// nothing can overlap, siblings line up and the scene fills the frame.

type Json = Record<string, unknown>;

/** A scene's arrangement, as checked from the designer's reply. */
export type LayoutNode =
  | { id: string; in?: LayoutNode }
  | { row: LayoutNode[] }
  | { col: LayoutNode[] }
  | { slot: LayoutNode[] };

// The part of the canvas a scene may fill, in canvas units (16 × 9): what the
// camera shows at its widest between the repository label and the captions
// (camera.js: L, R, TOP, BOT, less its margin).
const AREA = { w: 13.5, h: 5.8, cx: 8, cy: 4.25 };
const U = 120;
/** How big everything is drawn; the largest that fits the area is used. */
const DENSITY = { min: 0.6, max: 1.3 };
/** A turned arrangement must show the scene this much bigger to be used. */
const TURN_GAIN = 1.12;
const MAX_DEPTH = 5;
const MAX_CHILDREN = 8;
const GAP = { row: 0.65, col: 0.5, rowArrow: 1.15, colArrow: 0.9 };
/** Inside a browser window: the sides, and the bar above. */
const FRAME = { pad: 0.35, bar: 0.45 };

/** Kinds drawn as a card the same size as its neighbours of that kind. */
const UNIFORM = new Set(["box", "file", "chip", "stamp", "number"]);
/** Kinds that fill the width of a column they stand in. */
const PANELS = new Set(["code", "terminal", "table", "tree", "request"]);
/** Kinds whose text starts at their left edge. */
const TEXTY = new Set(["heading", "text", "list"]);

export interface PictureSize {
  width: number;
  height: number;
}

/** The designer's layout, cleaned: only known shapes, bounded in size. */
export function parseLayout(raw: unknown, depth = 0): LayoutNode | null {
  if (typeof raw === "string") {
    const text = raw.trim();
    if (/^[[{]/.test(text))
      try {
        return parseLayout(JSON.parse(text), depth);
      } catch {
        return null;
      }
    return text ? { id: text } : null;
  }
  if (!raw || typeof raw !== "object" || depth > MAX_DEPTH) return null;
  if (Array.isArray(raw)) return parseLayout({ row: raw }, depth);
  const node = raw as Json;
  for (const key of ["row", "col", "slot"] as const) {
    const list = node[key] ?? (key === "col" ? node.column : undefined);
    if (!Array.isArray(list)) continue;
    const children = list
      .slice(0, MAX_CHILDREN)
      .map((child) => parseLayout(child, depth + 1))
      .filter((child): child is LayoutNode => child !== null);
    if (!children.length) return null;
    if (children.length === 1) return children[0]!;
    return { [key]: children } as LayoutNode;
  }
  if (typeof node.id !== "string" || !node.id.trim()) return null;
  const inner = node.in === undefined ? null : parseLayout(node.in, depth + 1);
  return inner ? { id: node.id, in: inner } : { id: node.id };
}

const longest = (lines: unknown): number =>
  Math.max(
    0,
    ...(Array.isArray(lines) ? lines : []).map((line) => String(line).length),
  );
const count = (lines: unknown): number =>
  Array.isArray(lines) ? lines.length : 0;
const str = (value: unknown) => (typeof value === "string" ? value : "");
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

interface Size {
  w: number;
  h: number;
}

/**
 * The size an element wants at density `k`, from what it shows: the engine
 * fits text to its box, so an estimate a little off only changes the type
 * size slightly. `typed` is how many lines later "type" actions add.
 */
function naturalSize(
  e: ShotElement,
  k: number,
  typed: string[],
  pictures: Record<string, PictureSize>,
): Size {
  const px = (w: number, h: number): Size => ({ w: w / U, h: h / U });
  switch (e.kind) {
    case "heading": {
      const text = str(e.text).replace(/\*/g, "");
      const lines = text.length <= 18 ? 1 : text.length <= 44 ? 2 : 3;
      const font = (lines === 1 ? 128 : lines === 2 ? 104 : 84) * k;
      const perLine = Math.ceil(text.length / lines) + (lines > 1 ? 3 : 1);
      return px(perLine * font * 0.4 + 20, lines * font * 1.04 + 16);
    }
    case "text": {
      const text = str(e.text);
      const font = ({ s: 28, m: 38, l: 50 }[str(e.size)] ?? 38) * k;
      const wide = e.mono ? 0.6 : 0.54;
      const perLine = e.size === "s" ? 44 : e.size === "l" ? 28 : 36;
      const lines = Math.max(1, Math.ceil(text.length / perLine));
      const chars = Math.min(text.length, Math.ceil(text.length / lines) + 3);
      return px(chars * font * wide + 16, lines * font * 1.28 + 10);
    }
    case "code": {
      const all = [...((e.lines as string[]) ?? []), ...typed];
      const font = 27 * k;
      return px(
        96 + clamp(longest(all), 24, 66) * 0.6 * font + 14,
        52 + 26 + Math.max(2, all.length) * 1.62 * font + 6,
      );
    }
    case "terminal": {
      const all = [...((e.lines as string[]) ?? []), ...typed];
      const font = 27 * k;
      return px(
        48 + clamp(longest(all), 26, 66) * 0.6 * font + 12,
        44 + 24 + Math.max(2, all.length) * 1.55 * font + 10,
      );
    }
    case "box": {
      const label = str(e.label);
      const sub = str(e.sub);
      const font = 34 * k;
      const lines = label.length > 13 && label.includes(" ") ? 2 : 1;
      const perLine =
        lines === 2 ? Math.ceil(label.length / 2) + 3 : label.length;
      const icon = e.icon && e.icon !== "none" ? 60 * k : 0;
      const text = Math.max(
        perLine * font * 0.56,
        sub.length * 0.6 * Math.max(15, 20 * k),
      );
      return {
        w: clamp((44 + icon + text + 14) / U, 2.6 * k, 6),
        h: (lines * font * 1.12 + (sub ? 34 * k : 0) + 58 * k) / U,
      };
    }
    case "chip":
      return px(46 + str(e.text).length * 0.6 * 34 * k + 12, 80 * k);
    case "file": {
      const parts = str(e.path).split("/");
      const name = parts.pop() ?? "";
      const dir = parts.join("/");
      return px(
        Math.max(
          360 * k,
          92 + Math.max(name.length * 0.6 * 28, dir.length * 0.6 * 20) * k + 16,
        ),
        (dir ? 122 : 104) * k,
      );
    }
    case "tree": {
      const font = 22 * k;
      return px(
        Math.max(480 * k, 60 + longest(e.paths) * 0.6 * font + 20),
        48 + 20 + Math.max(2, count(e.paths)) * 1.7 * font,
      );
    }
    case "table": {
      const columns = (e.columns as string[]) ?? [];
      const rows = (e.rows as string[][]) ?? [];
      const cols = Math.max(
        columns.length,
        ...rows.map((row) => row.length),
        1,
      );
      let chars = 0;
      for (let c = 0; c < cols; c++)
        chars += Math.max(
          4,
          (columns[c] ?? "").length,
          ...rows.map((row) => (row[c] ?? "").length),
        );
      const font = 23 * k;
      return px(
        Math.max(540 * k, 40 + cols * 20 + chars * 0.6 * font + 24),
        16 + (rows.length + (columns.length ? 1 : 0)) * 56 * k,
      );
    }
    case "bars":
      return {
        w: 7.2 * k,
        h: Math.max(1.8, count(e.items) * 0.82 * k),
      };
    case "number": {
      const digits = `${str(e.prefix)}${Number(e.value).toLocaleString("en-US")}`;
      const size = 150 * k;
      const label = str(e.label);
      return px(
        Math.max(
          digits.length * size * 0.5 + str(e.suffix).length * size * 0.3 + 24,
          label.length * 0.52 * 26 * k,
        ),
        size + (label ? 50 * k : 0) + 8,
      );
    }
    case "stamp":
      return px(64 + str(e.text).length * 0.68 * 50 * k, 100 * k);
    case "request": {
      const font = 24 * k;
      const lines = count(e.lines);
      return px(
        clamp(
          260 +
            Math.max(10, str(e.url).length, longest(e.lines) * 0.8) *
              0.6 *
              font,
          600 * k,
          1200,
        ),
        lines ? 84 * k + 22 + lines * 1.5 * 20 * k : 92 * k,
      );
    }
    case "list": {
      const font = 31 * k;
      return px(
        60 + longest(e.items) * 0.52 * font + 30,
        count(e.items) * (font * 1.25 + 14),
      );
    }
    case "image": {
      const picture = pictures[str(e.src)];
      const ratio = picture
        ? clamp(picture.width / Math.max(1, picture.height), 0.4, 3.2)
        : 4 / 3;
      // A logo is not blown up to the size a screenshot deserves.
      const small = picture && Math.max(picture.width, picture.height) < 420;
      let h = (small ? 3.4 : 5.4) * k;
      let w = h * ratio;
      if (w > 9.6 * k) {
        w = 9.6 * k;
        h = w / ratio;
      }
      return { w: w + 0.2, h: h + 0.2 };
    }
    case "browser":
      return { w: 6.5 * k, h: 3.8 * k };
    default:
      return {
        w: clamp(Number(e.w) || 4, 1.5, 8) * k,
        h: clamp(Number(e.h) || 3, 1.5, 5) * k,
      };
  }
}

interface Measured extends Size {
  node: LayoutNode;
  children: Measured[];
  /** Gaps before each child after the first. */
  gaps: number[];
  /** Room each child gets along the node's axis, when wider than the child. */
  tracks?: number[];
  element?: ShotElement;
}

/** Every element id under a node. */
function idsOf(node: LayoutNode, out: string[] = []): string[] {
  if ("id" in node) {
    out.push(node.id);
    if (node.in) idsOf(node.in, out);
  } else
    for (const child of Object.values(node)[0] as LayoutNode[])
      idsOf(child, out);
  return out;
}

/**
 * Sets x, y, w and h on every element of one scene from its layout. Elements
 * the layout forgot are added in a row beneath it; ids it names that no
 * element has are ignored. Returns each slot as the groups of element ids
 * that take turns in it.
 */
export function solveLayout(params: {
  layout: LayoutNode | null;
  elements: ShotElement[];
  arrows: ShotElement[];
  actions: ShotAction[];
  pictures?: Record<string, PictureSize>;
}): { slots: string[][][] } {
  const { elements, arrows, actions, pictures = {} } = params;
  const byId = new Map(elements.map((element) => [element.id, element]));
  if (!byId.size) return { slots: [] };
  const typed = new Map<string, string[]>();
  for (const action of actions)
    if (action.do === "type" && action.target[0])
      typed.set(action.target[0], [
        ...(typed.get(action.target[0]) ?? []),
        String(action.line ?? ""),
      ]);

  // An element is sized for the longest text a "replace" will give it.
  const widest = (element: ShotElement): ShotElement => {
    const field = element.kind === "box" ? "label" : "text";
    let text = str(element[field]);
    for (const action of actions)
      if (
        action.do === "replace" &&
        action.target[0] === element.id &&
        str(action.text).length > text.length
      )
        text = str(action.text);
    return text === element[field] ? element : { ...element, [field]: text };
  };

  // Keep only nodes naming a real element, each element once.
  const used = new Set<string>();
  const prune = (node: LayoutNode): LayoutNode | null => {
    if ("id" in node) {
      const element = byId.get(node.id);
      if (!element || used.has(node.id)) return node.in ? prune(node.in) : null;
      used.add(node.id);
      // Only a browser window can hold other elements.
      if (!node.in) return { id: node.id };
      const inner = prune(node.in);
      if (element.kind === "browser")
        return inner ? { id: node.id, in: inner } : { id: node.id };
      return inner ? { col: [{ id: node.id }, inner] } : { id: node.id };
    }
    const [key, list] = Object.entries(node)[0] as [string, LayoutNode[]];
    const children = list
      .map(prune)
      .filter((child): child is LayoutNode => child !== null);
    if (!children.length) return null;
    return children.length === 1
      ? children[0]!
      : ({ [key]: children } as LayoutNode);
  };
  let root = params.layout ? prune(params.layout) : null;
  const missing = elements.filter((element) => !used.has(element.id));
  if (missing.length) {
    const rows: LayoutNode[] = [];
    for (let i = 0; i < missing.length; i += 3) {
      const ids = missing
        .slice(i, i + 3)
        .map((element) => ({ id: element.id }));
      rows.push(ids.length === 1 ? ids[0]! : { row: ids });
    }
    const extra = rows.length === 1 ? rows[0]! : ({ col: rows } as LayoutNode);
    root = root ? { col: [root, extra] } : extra;
  }
  if (!root) return { slots: [] };

  // Which elements an arrow joins, so the gap it crosses has room for it.
  const joined = (a: LayoutNode, b: LayoutNode): { label: number } | null => {
    const left = new Set(idsOf(a));
    const right = new Set(idsOf(b));
    let label = -1;
    for (const arrow of arrows) {
      const from = String(arrow.from);
      const to = String(arrow.to);
      if (
        (left.has(from) && right.has(to)) ||
        (left.has(to) && right.has(from))
      )
        label = Math.max(label, str(arrow.label).length);
    }
    return label < 0 ? null : { label };
  };

  // Cards of one kind are one size across the scene (chips share a height
  // and keep their own widths), so the scene reads as one system.
  const sizes = new Map<number, Map<string, Size>>();
  const sizeOf = (element: ShotElement, k: number): Size => {
    let table = sizes.get(k);
    if (!table) {
      table = new Map();
      sizes.set(k, table);
      const placed = elements.filter(
        (e) => used.has(e.id) || missing.includes(e),
      );
      for (const e of placed)
        table.set(
          e.id,
          naturalSize(widest(e), k, typed.get(e.id) ?? [], pictures),
        );
      for (const kind of UNIFORM) {
        const group = placed.filter((e) => e.kind === kind);
        if (group.length < 2) continue;
        const w = Math.max(...group.map((e) => table!.get(e.id)!.w));
        const h = Math.max(...group.map((e) => table!.get(e.id)!.h));
        for (const e of group)
          table.set(e.id, { w: kind === "chip" ? table.get(e.id)!.w : w, h });
      }
    }
    return { ...table.get(element.id)! };
  };

  const measure = (node: LayoutNode, k: number): Measured => {
    if ("id" in node) {
      const element = byId.get(node.id)!;
      if (node.in) {
        const inner = measure(node.in, k);
        return {
          node,
          element,
          children: [inner],
          gaps: [],
          w: Math.max(inner.w + 2 * FRAME.pad, 5),
          h: Math.max(inner.h + 2 * FRAME.pad + FRAME.bar, 3),
        };
      }
      return { node, element, children: [], gaps: [], ...sizeOf(element, k) };
    }
    const [key, list] = Object.entries(node)[0] as [string, LayoutNode[]];
    const children = list.map((child) => measure(child, k));
    // Rows of a column (or columns of a row) with the same number of parts
    // form a grid: each part's room is the widest in its track.
    const grid =
      key !== "slot" &&
      children.length > 1 &&
      children.every(
        (child) =>
          !child.element &&
          !("slot" in child.node) &&
          Object.keys(child.node)[0] !== key &&
          child.children.length === children[0]!.children.length,
      );
    if (grid) {
      const inner = Object.keys(children[0]!.node)[0] === "row";
      const n = children[0]!.children.length;
      const tracks = Array.from({ length: n }, (_, i) =>
        Math.max(
          ...children.map((c) => (inner ? c.children[i]!.w : c.children[i]!.h)),
        ),
      );
      const gaps = Array.from({ length: n - 1 }, (_, i) =>
        Math.max(...children.map((c) => c.gaps[i]!)),
      );
      const total =
        tracks.reduce((sum, t) => sum + t, 0) +
        gaps.reduce((sum, g) => sum + g, 0);
      for (const child of children) {
        child.tracks = tracks;
        child.gaps = gaps;
        if (inner) child.w = total;
        else child.h = total;
      }
    }
    if (key === "slot")
      return {
        node,
        children,
        gaps: [],
        w: Math.max(...children.map((child) => child.w)),
        h: Math.max(...children.map((child) => child.h)),
      };
    const row = key === "row";
    const gaps = list.slice(1).map((child, i) => {
      const arrow = joined(list[i]!, child);
      // A crowded scene closes up a little, but an arrow keeps its room.
      const tight = clamp(k, 0.75, 1);
      if (!arrow) return (row ? GAP.row : GAP.col) * tight;
      return row
        ? Math.max(
            GAP.rowArrow * tight,
            arrow.label ? arrow.label * 0.112 + 1 : 0,
          )
        : (GAP.colArrow + (arrow.label ? 0.1 : 0)) * tight;
    });
    const gapSum = gaps.reduce((sum, gap) => sum + gap, 0);
    const along = (child: Measured) => (row ? child.w : child.h);
    const across = (child: Measured) => (row ? child.h : child.w);
    const total =
      children.reduce((sum, child) => sum + along(child), 0) + gapSum;
    const thick = Math.max(...children.map(across));
    // Panels fill the width of their column.
    if (!row)
      for (const child of children)
        if (
          child.element &&
          !child.children.length &&
          PANELS.has(child.element.kind) &&
          child.w >= thick * 0.6
        )
          child.w = thick;
    return {
      node,
      children,
      gaps,
      w: row ? total : thick,
      h: row ? thick : total,
    };
  };

  // How big a tree can be drawn: the density it fits at, less any shrinking.
  const fitted = (tree: LayoutNode) => {
    const fits = (k: number) => {
      const m = measure(tree, k);
      return m.w <= AREA.w && m.h <= AREA.h;
    };
    // The largest density that fits, found by halving the range it lies in.
    let lo = DENSITY.min;
    let hi = DENSITY.max;
    if (fits(hi)) lo = hi;
    else if (fits(lo))
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
    const density = Math.round(lo * 100) / 100;
    const m = measure(tree, density);
    // Still too big at the smallest density: the whole scene shrinks to fit.
    const fit = Math.min(1, AREA.w / m.w, AREA.h / m.h);
    return { tree, measured: m, fit, score: density * fit };
  };
  // The designer's arrangement, or the same one with its outer rows and
  // columns turned (a row of two wide panels becomes a stack) when that
  // shows everything clearly bigger.
  const turnable: LayoutNode[] = [];
  const collect = (node: LayoutNode, depth: number) => {
    if ("id" in node || "slot" in node || depth > 1) return;
    turnable.push(node);
    for (const child of Object.values(node)[0] as LayoutNode[])
      collect(child, depth + 1);
  };
  collect(root, 0);
  const turned = (node: LayoutNode, flips: Set<LayoutNode>): LayoutNode => {
    if ("id" in node || "slot" in node) return node;
    const [key, list] = Object.entries(node)[0] as [string, LayoutNode[]];
    const children = list.map((child) => turned(child, flips));
    const flipped = flips.has(node) ? (key === "row" ? "col" : "row") : key;
    return { [flipped]: children } as LayoutNode;
  };
  let best = fitted(root);
  const asDesigned = best.score;
  const options = turnable.slice(0, 5);
  for (let mask = 1; mask < 1 << options.length; mask++) {
    const flips = new Set(options.filter((_, bit) => mask & (1 << bit)));
    const candidate = fitted(turned(root, flips));
    if (
      candidate.score > asDesigned * TURN_GAIN &&
      candidate.score > best.score
    )
      best = candidate;
  }
  const { measured, fit } = best;

  const slots: string[][][] = [];
  const place = (m: Measured, x: number, y: number) => {
    if (m.element) {
      // A box drawn too small for its second line shows its label alone:
      // a clean card beats a path cut off after a few letters.
      if (m.element.kind === "box" && m.element.sub) {
        const icon = m.element.icon && m.element.icon !== "none" ? 60 : 0;
        const room = m.w * fit * U - 44 - icon;
        if (str(m.element.sub).length * 0.6 * 14 > room) m.element.sub = "";
      }
      Object.assign(m.element, {
        x: round(AREA.cx + (x - measured.w / 2) * fit),
        y: round(AREA.cy + (y - measured.h / 2) * fit),
        w: round(m.w * fit),
        h: round(m.h * fit),
      });
      const inner = m.children[0];
      if (inner)
        place(
          inner,
          x + (m.w - inner.w) / 2,
          y + FRAME.bar + (m.h - FRAME.bar - inner.h) / 2,
        );
      return;
    }
    const key = Object.keys(m.node)[0];
    if (key === "slot") {
      const ids = m.children
        .map((child) => idsOf(child.node))
        .filter((list) => list.length);
      if (ids.length > 1) slots.push(ids);
      for (const child of m.children)
        place(child, x + (m.w - child.w) / 2, y + (m.h - child.h) / 2);
      return;
    }
    const row = key === "row";
    // A column holding text reads from its left edge; anything else centres.
    const start =
      !row &&
      m.children.some(
        (child) => child.element && TEXTY.has(child.element.kind),
      );
    let at = 0;
    m.children.forEach((child, i) => {
      if (i) at += m.gaps[i - 1]!;
      const room = m.tracks?.[i] ?? (row ? child.w : child.h);
      const slack = (room - (row ? child.w : child.h)) / 2;
      if (row) place(child, x + at + slack, y + (m.h - child.h) / 2);
      else place(child, x + (start ? 0 : (m.w - child.w) / 2), y + at + slack);
      at += room;
    });
  };
  place(measured, 0, 0);
  return { slots };
}

const round = (n: number) => Math.round(n * 100) / 100;
