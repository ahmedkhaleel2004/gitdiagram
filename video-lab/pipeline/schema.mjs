// The video plan the model writes. Structured output cannot express string or
// array length limits, so they live in LIMITS and normalize() enforces them.

const str = { type: "string" };
const obj = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const arr = (items) => ({ type: "array", items });
const cue = { type: "string", description: "One word copied verbatim from this beat's narration; the item appears when it is spoken." };

const scene = {
  hook: obj({ type: { const: "hook" }, components: arr(str) }),
  stack: obj({ type: { const: "stack" }, badges: arr(str), folders: arr(obj({ path: str, note: str, cue })) }),
  tree: obj({ type: { const: "tree" }, rows: arr(obj({ path: str, note: str, cue })) }),
  flow: obj({ type: { const: "flow" }, title: str, steps: arr(obj({ label: str, detail: str, cue })) }),
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
    nodes: arr(
      obj({
        id: str,
        label: str,
        sub: str,
        group: str,
        kind: { type: "string", enum: ["box", "store", "actor", "external"] },
        cue,
      }),
    ),
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
    messages: arr(obj({ text: str, dir: { type: "string", enum: ["right", "left"] }, cue })),
  }),
  stats: obj({
    type: { const: "stats" },
    items: arr(obj({ value: { type: "number" }, suffix: str, label: str, cue })),
  }),
  compare: obj({
    type: { const: "compare" },
    left: obj({ title: str, items: arr(str), cue }),
    right: obj({ title: str, items: arr(str), cue }),
  }),
  idea: obj({ type: { const: "idea" } }),
  close: obj({ type: { const: "close" } }),
};

export const SCENE_TYPES = Object.keys(scene);

export const SCHEMA = obj({
  title: str,
  hook: str,
  idea: obj({ teaser: str, statement: str, emphasis: str }),
  beats: arr(
    obj({
      chapter: str,
      narration: str,
      scene: { anyOf: Object.values(scene) },
    }),
  ),
  takeaway: arr(obj({ text: str, cue })),
  startHere: obj({ path: str, files: arr(str) }),
  architecture: obj({
    groups: arr(obj({ id: str, label: str })),
    nodes: arr(obj({ id: str, label: str, sub: str, group: str, kind: { type: "string", enum: ["box", "store", "actor", "external"] } })),
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

// Clip to a limit, preferring a word boundary so text never ends mid-word.
const clip = (s, n) => {
  s = String(s ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–—]+$/, "") + "…";
};
const words = (s) =>
  String(s)
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9.#/]/g, "").replace(/\.$/, ""))
    .filter(Boolean);

// Enforce limits, repair cues, and check claims against the real repository.
export function normalize(spec, ctx) {
  const warnings = [];
  const paths = new Set(ctx.paths);
  const dirs = new Set(ctx.paths.flatMap((p) => p.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))));
  const pathExists = (p) => {
    const q = String(p).replace(/^\.?\//, "").replace(/\/$/, "");
    return paths.has(q) || dirs.has(q) || q === "";
  };
  const fileText = new Map(ctx.files.map((f) => [f.path, f.text]));

  spec.title = clip(spec.title || ctx.meta.name, LIMITS.title);
  spec.hook = clip(spec.hook, LIMITS.hook);
  if (spec.idea) {
    spec.idea.teaser = clip(spec.idea.teaser, LIMITS.teaser);
    spec.idea.statement = clip(spec.idea.statement, LIMITS.statement);
  }

  const beats = spec.beats.filter((b) => b?.scene && SCENE_TYPES.includes(b.scene.type) && b.narration);
  if (beats[0]?.scene.type !== "hook") warnings.push("first beat is not a hook");
  if (beats.at(-1)?.scene.type !== "close") {
    warnings.push("last beat is not a close; appending one");
    beats.push({ chapter: "Recap", narration: spec.takeaway.map((t) => t.text).join(" "), scene: { type: "close" } });
  }
  if (!beats.some((b) => b.scene.type === "idea")) spec.idea = null;

  // A cue must be a word of its own beat's narration; otherwise fall back to even spacing.
  const fixCue = (c, narration, where) => {
    const w = words(c)[0];
    if (w && words(narration).includes(w)) return w;
    if (c) warnings.push(`cue "${c}" not in narration (${where})`);
    return "";
  };

  beats.forEach((b, i) => {
    const s = b.scene;
    const at = `beat ${i + 1} ${s.type}`;
    b.chapter = clip(b.chapter, LIMITS.chapter);
    b.narration = String(b.narration).replace(/\s+/g, " ").trim();
    const n = b.narration;
    const cued = (list, limit, fn) =>
      (list || []).slice(0, limit).map((x) => ({ ...fn(x), cue: fixCue(x.cue, n, at) }));
    switch (s.type) {
      case "hook":
        s.components = (s.components || []).slice(0, 6).map((c) => clip(c, LIMITS.component));
        break;
      case "stack":
        s.badges = (s.badges || []).slice(0, 5).map((c) => clip(c, LIMITS.badge));
        s.folders = cued(s.folders, 7, (f) => ({ path: clip(f.path, LIMITS.path), note: clip(f.note, LIMITS.note) }));
        s.folders.forEach((f) => !pathExists(f.path) && warnings.push(`unknown folder ${f.path} (${at})`));
        break;
      case "tree":
        s.rows = cued(s.rows, 12, (r) => ({ path: clip(r.path, LIMITS.path), note: clip(r.note, LIMITS.note) }));
        s.rows = s.rows.filter((r) => {
          const ok = pathExists(r.path);
          if (!ok) warnings.push(`dropped unknown path ${r.path} (${at})`);
          return ok;
        });
        break;
      case "flow":
        s.title = clip(s.title, 40);
        s.steps = cued(s.steps, 6, (x) => ({ label: clip(x.label, LIMITS.label), detail: clip(x.detail, LIMITS.detail) }));
        break;
      case "code": {
        s.lines = (s.lines || []).slice(0, 14).map((l) => {
          const t = String(l).replace(/\t/g, "  ").replace(/\s+$/, "");
          return t.length > LIMITS.codeLine ? t.slice(0, LIMITS.codeLine - 1) + "…" : t;
        });
        s.highlights = cued(s.highlights, 3, (h) => ({
          line: Math.min(Math.max(1, h.line | 0), s.lines.length),
          note: clip(h.note, LIMITS.note),
        }));
        if (!pathExists(s.path)) warnings.push(`code path ${s.path} not in repo (${at})`);
        const src = fileText.get(s.path) || "";
        const found = s.lines.filter((l) => l.trim().length > 6 && src.includes(l.trim().replace(/…$/, ""))).length;
        const real = s.lines.filter((l) => l.trim().length > 6).length;
        if (real && found / real < 0.5) warnings.push(`code lines mostly not verbatim from ${s.path} (${found}/${real})`);
        break;
      }
      case "graph":
        s.title = clip(s.title, 40);
        s.groups = (s.groups || []).slice(0, 3).map((g) => ({ id: g.id, label: clip(g.label, 24) }));
        s.nodes = cued(s.nodes, 8, (x) => ({
          id: x.id,
          label: clip(x.label, LIMITS.label),
          sub: clip(x.sub, LIMITS.sub),
          group: x.group,
          kind: x.kind,
        }));
        s.edges = graphEdges(s.edges, s.nodes, 10);
        break;
      case "checklist":
        s.title = clip(s.title, 34);
        s.verdict = clip(s.verdict, 16);
        s.items = cued(s.items, 6, (x) => ({ text: clip(x.text, LIMITS.item), ok: Boolean(x.ok) }));
        break;
      case "stream":
        s.left = { label: clip(s.left?.label, 18), sub: clip(s.left?.sub, LIMITS.sub) };
        s.right = { label: clip(s.right?.label, 18), sub: clip(s.right?.sub, LIMITS.sub) };
        s.messages = cued(s.messages, 7, (x) => ({ text: clip(x.text, LIMITS.message), dir: x.dir === "left" ? "left" : "right" }));
        break;
      case "stats":
        s.items = cued(s.items, 4, (x) => ({
          value: Number.isFinite(+x.value) ? +x.value : 0,
          suffix: clip(x.suffix, LIMITS.suffix),
          label: clip(x.label, LIMITS.statLabel),
        }));
        break;
      case "compare":
        for (const side of ["left", "right"]) {
          s[side] = {
            title: clip(s[side]?.title, 24),
            items: (s[side]?.items || []).slice(0, 4).map((x) => clip(x, LIMITS.item)),
            cue: fixCue(s[side]?.cue, n, at),
          };
        }
        break;
    }
  });
  spec.beats = beats;

  const closeNarr = beats.at(-1).narration;
  spec.takeaway = (spec.takeaway || []).slice(0, 2).map((t) => ({ text: clip(t.text, LIMITS.takeaway), cue: fixCue(t.cue, closeNarr, "takeaway") }));
  spec.startHere = {
    path: clip(spec.startHere?.path, 40),
    files: (spec.startHere?.files || []).slice(0, 5).map((f) => clip(f, 28)),
  };
  if (spec.startHere.path && !pathExists(spec.startHere.path)) warnings.push(`startHere ${spec.startHere.path} not in repo`);
  const a = spec.architecture || { groups: [], nodes: [], edges: [] };
  a.groups = (a.groups || []).slice(0, 3).map((g) => ({ id: g.id, label: clip(g.label, 24) }));
  a.nodes = (a.nodes || []).slice(0, 8).map((x) => ({ id: x.id, label: clip(x.label, LIMITS.label), sub: clip(x.sub, LIMITS.sub), group: x.group, kind: x.kind }));
  a.edges = graphEdges(a.edges, a.nodes, 10);
  spec.architecture = a;
  return { spec, warnings };
}

function graphEdges(edges, nodes, limit) {
  const ids = new Set(nodes.map((x) => x.id));
  return (edges || [])
    .filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
    .slice(0, limit)
    .map((e) => ({ from: e.from, to: e.to, label: clip(e.label, LIMITS.edgeLabel) }));
}
