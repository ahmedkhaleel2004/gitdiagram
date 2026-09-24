import {
  VIDEO_SCENE_TYPES,
  type VideoBeat,
  type VideoGraph,
  type VideoPlan,
  type VideoScene,
  type VideoSceneType,
} from "~/features/video/types";

// The plan the model writes. Structured output cannot express string or array
// length limits, so LIMITS holds them and normalizeVideoPlan enforces them.

type JsonSchema = Record<string, unknown>;
const str: JsonSchema = { type: "string" };
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const arr = (items: JsonSchema): JsonSchema => ({ type: "array", items });
const cue: JsonSchema = {
  type: "string",
  description:
    "One word copied verbatim from this beat's narration; the item appears when it is spoken.",
};
const kind: JsonSchema = {
  type: "string",
  enum: ["box", "store", "actor", "external"],
};

const SCENES: Record<VideoSceneType, JsonSchema> = {
  hook: obj({ type: { const: "hook" }, components: arr(str) }),
  stack: obj({
    type: { const: "stack" },
    badges: arr(str),
    folders: arr(obj({ path: str, note: str, cue })),
  }),
  tree: obj({
    type: { const: "tree" },
    rows: arr(obj({ path: str, note: str, cue })),
  }),
  flow: obj({
    type: { const: "flow" },
    title: str,
    steps: arr(obj({ label: str, detail: str, cue })),
  }),
  code: obj({
    type: { const: "code" },
    path: str,
    lines: arr(str),
    highlights: arr(obj({ line: { type: "integer" }, note: str, cue })),
  }),
  graph: obj({
    type: { const: "graph" },
    title: str,
    groups: arr(obj({ id: str, label: str })),
    nodes: arr(obj({ id: str, label: str, sub: str, group: str, kind, cue })),
    edges: arr(obj({ from: str, to: str, label: str })),
  }),
  checklist: obj({
    type: { const: "checklist" },
    title: str,
    items: arr(obj({ text: str, ok: { type: "boolean" }, cue })),
    verdict: str,
  }),
  stream: obj({
    type: { const: "stream" },
    left: obj({ label: str, sub: str }),
    right: obj({ label: str, sub: str }),
    messages: arr(
      obj({ text: str, dir: { type: "string", enum: ["right", "left"] }, cue }),
    ),
  }),
  stats: obj({
    type: { const: "stats" },
    items: arr(
      obj({ value: { type: "number" }, suffix: str, label: str, cue }),
    ),
  }),
  compare: obj({
    type: { const: "compare" },
    left: obj({ title: str, items: arr(str), cue }),
    right: obj({ title: str, items: arr(str), cue }),
  }),
  idea: obj({ type: { const: "idea" } }),
  close: obj({ type: { const: "close" } }),
};

export const VIDEO_PLAN_SCHEMA: JsonSchema = obj({
  title: str,
  hook: str,
  idea: obj({ teaser: str, statement: str, emphasis: str }),
  beats: arr(
    obj({
      chapter: str,
      narration: str,
      scene: { anyOf: Object.values(SCENES) },
    }),
  ),
  takeaway: arr(obj({ text: str, cue })),
  startHere: obj({ path: str, files: arr(str) }),
  architecture: obj({
    groups: arr(obj({ id: str, label: str })),
    nodes: arr(obj({ id: str, label: str, sub: str, group: str, kind })),
    edges: arr(obj({ from: str, to: str, label: str })),
  }),
});

const LIMITS = {
  title: 28,
  hook: 64,
  chapter: 12,
  component: 16,
  badge: 14,
  path: 46,
  note: 44,
  label: 22,
  detail: 34,
  codeLine: 66,
  sub: 26,
  edgeLabel: 16,
  message: 40,
  item: 38,
  statLabel: 28,
  suffix: 6,
  statement: 70,
  teaser: 22,
  takeaway: 36,
};

type Json = Record<string, unknown>;
const rec = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
const list = (value: unknown): Json[] =>
  Array.isArray(value) ? value.map(rec) : [];
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => text(item)) : [];
const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/** Clip to a limit at a word boundary so on-screen text never ends mid-word. */
export function clip(value: unknown, limit: number): string {
  const s = text(value).replace(/\s+/g, " ").trim();
  if (s.length <= limit) return s;
  const cut = s.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  return (
    (space > limit * 0.6 ? cut.slice(0, space) : cut).replace(
      /[\s,;:.\-–—]+$/,
      "",
    ) + "…"
  );
}

/** Same normalization the narration clock applies to spoken words. */
export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^a-z0-9.#/]/g, "")
    .replace(/\.$/, "");
}

const words = (sentence: string) =>
  sentence.split(/\s+/).map(normalizeWord).filter(Boolean);

export interface PlanRepositoryFacts {
  name: string;
  /** Every path in the repository tree. */
  paths: string[];
  /** Source excerpts the planner saw; code lines must come from here. */
  sourceText: string;
}

/** Enforce limits, repair cues, and check claims against the real repository. */
export function normalizeVideoPlan(
  raw: unknown,
  facts: PlanRepositoryFacts,
): { plan: VideoPlan; warnings: string[] } {
  const warnings: string[] = [];
  const input = rec(raw);
  const paths = new Set(facts.paths);
  const dirs = new Set<string>();
  for (const path of facts.paths) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++)
      dirs.add(parts.slice(0, i).join("/"));
  }
  const pathExists = (path: string) => {
    const clean = path.replace(/^\.?\//, "").replace(/\/$/, "");
    return clean === "" || paths.has(clean) || dirs.has(clean);
  };

  const beats: VideoBeat[] = [];
  for (const beat of list(input.beats)) {
    const scene = rec(beat.scene);
    const type = text(scene.type) as VideoSceneType;
    const narration = text(beat.narration).replace(/\s+/g, " ").trim();
    if (!VIDEO_SCENE_TYPES.includes(type) || !narration) continue;
    beats.push({
      chapter: clip(beat.chapter, LIMITS.chapter),
      narration,
      scene: { ...scene, type },
    });
  }
  const rawTakeaway = list(input.takeaway);
  if (beats[0]?.scene.type !== "hook")
    warnings.push("first beat is not a hook");
  if (beats.at(-1)?.scene.type !== "close") {
    warnings.push("last beat is not a close; appended one");
    beats.push({
      chapter: "Recap",
      narration:
        rawTakeaway.map((item) => text(item.text)).join(" ") || facts.name,
      scene: { type: "close" },
    });
  }

  // A cue must be a word of its own beat's narration; otherwise the engine spaces it evenly.
  const fixCue = (value: unknown, narration: string, where: string) => {
    const word = words(text(value))[0];
    if (word && words(narration).includes(word)) return word;
    if (text(value))
      warnings.push(`cue "${text(value)}" not in narration (${where})`);
    return "";
  };

  beats.forEach((beat, index) => {
    const scene = beat.scene;
    const where = `beat ${index + 1} ${scene.type}`;
    const cued = <T extends object>(
      items: unknown,
      limit: number,
      map: (item: Json) => T,
    ) =>
      list(items)
        .slice(0, limit)
        .map((item) => ({
          ...map(item),
          cue: fixCue(item.cue, beat.narration, where),
        }));
    const next: VideoScene = { type: scene.type };
    switch (scene.type) {
      case "hook":
        next.components = strings(scene.components)
          .slice(0, 6)
          .map((item) => clip(item, LIMITS.component));
        break;
      case "stack": {
        next.badges = strings(scene.badges)
          .slice(0, 5)
          .map((item) => clip(item, LIMITS.badge));
        const folders = cued(scene.folders, 7, (item) => ({
          path: clip(item.path, LIMITS.path),
          note: clip(item.note, LIMITS.note),
        }));
        for (const folder of folders)
          if (!pathExists(folder.path))
            warnings.push(`unknown folder ${folder.path} (${where})`);
        next.folders = folders;
        break;
      }
      case "tree":
        next.rows = cued(scene.rows, 12, (item) => ({
          path: clip(item.path, LIMITS.path),
          note: clip(item.note, LIMITS.note),
        })).filter((row) => {
          if (pathExists(row.path)) return true;
          warnings.push(`dropped unknown path ${row.path} (${where})`);
          return false;
        });
        break;
      case "flow":
        next.title = clip(scene.title, 40);
        next.steps = cued(scene.steps, 6, (item) => ({
          label: clip(item.label, LIMITS.label),
          detail: clip(item.detail, LIMITS.detail),
        }));
        break;
      case "code": {
        const lines = strings(scene.lines)
          .slice(0, 14)
          .map((line) => {
            const clean = line.replace(/\t/g, "  ").replace(/\s+$/, "");
            return clean.length > LIMITS.codeLine
              ? clean.slice(0, LIMITS.codeLine - 1) + "…"
              : clean;
          });
        const codePath = text(scene.path);
        next.path = codePath;
        next.lines = lines;
        next.highlights = cued(scene.highlights, 3, (item) => ({
          line: Math.min(
            Math.max(1, Math.trunc(Number(item.line)) || 1),
            lines.length || 1,
          ),
          note: clip(item.note, LIMITS.note),
        }));
        if (!pathExists(codePath))
          warnings.push(`code path ${codePath} not in repo (${where})`);
        const substantive = lines.filter((line) => line.trim().length > 6);
        const verbatim = substantive.filter((line) =>
          facts.sourceText.includes(line.trim().replace(/…$/, "")),
        );
        if (substantive.length && verbatim.length / substantive.length < 0.5)
          warnings.push(
            `code lines mostly not verbatim from ${codePath} (${verbatim.length}/${substantive.length})`,
          );
        break;
      }
      case "graph": {
        const graph = normalizeGraph(scene, 3, 8, 10);
        next.title = clip(scene.title, 40);
        next.groups = graph.groups;
        next.nodes = graph.nodes.map((node, i) => ({
          ...node,
          cue: fixCue(list(scene.nodes)[i]?.cue, beat.narration, where),
        }));
        next.edges = graph.edges;
        break;
      }
      case "checklist":
        next.title = clip(scene.title, 34);
        next.verdict = clip(scene.verdict, 16);
        next.items = cued(scene.items, 6, (item) => ({
          text: clip(item.text, LIMITS.item),
          ok: Boolean(item.ok),
        }));
        break;
      case "stream":
        next.left = {
          label: clip(rec(scene.left).label, 18),
          sub: clip(rec(scene.left).sub, LIMITS.sub),
        };
        next.right = {
          label: clip(rec(scene.right).label, 18),
          sub: clip(rec(scene.right).sub, LIMITS.sub),
        };
        next.messages = cued(scene.messages, 7, (item) => ({
          text: clip(item.text, LIMITS.message),
          dir: item.dir === "left" ? "left" : "right",
        }));
        break;
      case "stats":
        next.items = cued(scene.items, 4, (item) => {
          const value = Number(item.value);
          return {
            value: Number.isFinite(value) ? value : 0,
            suffix: clip(item.suffix, LIMITS.suffix),
            label: clip(item.label, LIMITS.statLabel),
          };
        });
        break;
      case "compare":
        for (const side of ["left", "right"] as const) {
          const value = rec(scene[side]);
          next[side] = {
            title: clip(value.title, 24),
            items: strings(value.items)
              .slice(0, 4)
              .map((item) => clip(item, LIMITS.item)),
            cue: fixCue(value.cue, beat.narration, where),
          };
        }
        break;
      case "idea":
      case "close":
        break;
    }
    beat.scene = next;
  });

  const idea = rec(input.idea);
  const hasIdea =
    beats.some((beat) => beat.scene.type === "idea") && text(idea.statement);
  const closeNarration = beats.at(-1)?.narration ?? "";
  const startHere = rec(input.startHere);
  const plan: VideoPlan = {
    title: clip(input.title || facts.name, LIMITS.title),
    hook: clip(input.hook, LIMITS.hook),
    idea: hasIdea
      ? {
          teaser: clip(idea.teaser, LIMITS.teaser),
          statement: clip(idea.statement, LIMITS.statement),
          emphasis: text(idea.emphasis),
        }
      : null,
    beats,
    takeaway: rawTakeaway.slice(0, 2).map((item) => ({
      text: clip(item.text, LIMITS.takeaway),
      cue: fixCue(item.cue, closeNarration, "takeaway"),
    })),
    startHere: {
      path: clip(startHere.path, 40),
      files: strings(startHere.files)
        .slice(0, 5)
        .map((file) => clip(file, 28)),
    },
    architecture: normalizeGraph(rec(input.architecture), 3, 8, 10),
  };
  if (plan.startHere.path && !pathExists(plan.startHere.path))
    warnings.push(`startHere ${plan.startHere.path} not in repo`);
  return { plan, warnings };
}

function normalizeGraph(
  graph: Json,
  maxGroups: number,
  maxNodes: number,
  maxEdges: number,
): VideoGraph {
  const nodes = list(graph.nodes)
    .slice(0, maxNodes)
    .map((node) => ({
      id: text(node.id),
      label: clip(node.label, LIMITS.label),
      sub: clip(node.sub, LIMITS.sub),
      group: text(node.group),
      kind: ["box", "store", "actor", "external"].includes(text(node.kind))
        ? text(node.kind)
        : "box",
    }));
  const ids = new Set(nodes.map((node) => node.id));
  return {
    groups: list(graph.groups)
      .slice(0, maxGroups)
      .map((group) => ({ id: text(group.id), label: clip(group.label, 24) })),
    nodes,
    edges: list(graph.edges)
      .filter(
        (edge) =>
          ids.has(text(edge.from)) &&
          ids.has(text(edge.to)) &&
          text(edge.from) !== text(edge.to),
      )
      .slice(0, maxEdges)
      .map((edge) => ({
        from: text(edge.from),
        to: text(edge.to),
        label: clip(edge.label, LIMITS.edgeLabel),
      })),
  };
}
