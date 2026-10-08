/**
 * Measures what a viewer would call broken, on the real stage: every beat is
 * held until its animations settle, then the DOM is read for elements that
 * collide, text that is cut, arrows that run through cards, and frames that
 * are nearly empty. Writes audit.json and contact sheets beside each film.
 *
 *   bun experiments/video-hillclimb/audit.ts <dir with film folders> [--no-sheets]
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoArtifact } from "~/features/explainer/types";
import { HOLD, closeBrowser, held, openStage, seek, tile } from "./stage";

export interface Defect {
  beat: number;
  type: string;
  detail: string;
  /** How bad, 0..1 within its type. */
  weight: number;
}

// Runs in the page: reads the visible scene.
function measure(beat: number, spec: VideoArtifact["plan"]) {
  const defects: Array<{
    beat: number;
    type: string;
    detail: string;
    weight: number;
  }> = [];
  const add = (type: string, detail: string, weight = 1) =>
    defects.push({ beat, type, detail, weight });
  const scenes = [
    ...document.querySelectorAll<HTMLElement>("#scenes section.scene"),
  ].filter((s) => getComputedStyle(s).visibility === "visible");
  const scene = scenes.find((s) => s.querySelector(".shot")) ?? scenes[0];
  if (!scene) return { defects, coverage: 0, count: 0, minText: 99 };
  const opacityOf = (el: Element) => {
    let o = 1;
    for (let n: Element | null = el; n && n !== scene; n = n.parentElement)
      o *= Number(getComputedStyle(n).opacity);
    return o;
  };
  type Box = {
    id: string;
    kind: string;
    x: number;
    y: number;
    w: number;
    h: number;
    el: HTMLElement;
    scale: number;
  };
  const shots: Box[] = [];
  for (const el of scene.querySelectorAll<HTMLElement>(".shot")) {
    if (opacityOf(el) < 0.2) continue;
    // A list and bars bring their rows in one by one: not there until one shows.
    if (
      (el.dataset.kind === "list" || el.dataset.kind === "bars") &&
      ![...el.children].some((c) => Number(getComputedStyle(c).opacity) > 0.2)
    )
      continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    shots.push({
      id: el.dataset.id ?? "",
      kind: el.dataset.kind ?? "",
      x: r.left,
      y: r.top,
      w: r.width,
      h: r.height,
      el,
      scale: r.width / Math.max(1, el.offsetWidth),
    });
  }
  const inter = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ) => {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  };
  const inside = (a: Box, b: Box) =>
    a.x >= b.x - 2 &&
    a.y >= b.y - 2 &&
    a.x + a.w <= b.x + b.w + 2 &&
    a.y + a.h <= b.y + b.h + 2;
  // 1. cards on cards
  for (let i = 0; i < shots.length; i++)
    for (let j = i + 1; j < shots.length; j++) {
      const a = shots[i]!,
        b = shots[j]!;
      if (a.kind === "browser" || b.kind === "browser") {
        // Content over a browser frame is the design; half in, half out is not.
        const [frame, other] = a.kind === "browser" ? [a, b] : [b, a];
        const area = inter(frame, other);
        if (area > 0 && area < other.w * other.h * 0.9 && !inside(other, frame))
          add("overlap", `${other.id} straddles browser ${frame.id}`, 0.6);
        continue;
      }
      if (inside(a, b) || inside(b, a)) continue;
      const area = inter(a, b);
      const small = Math.min(a.w * a.h, b.w * b.h);
      if (area > 500 && area > small * 0.04)
        add(
          "overlap",
          `${a.id}(${a.kind}) × ${b.id}(${b.kind}) ${Math.round((100 * area) / small)}%`,
          Math.min(1, 0.3 + area / small),
        );
    }
  // 2. cut by the frame, under the caption or the label
  const cap = document.getElementById("captions");
  const capBox =
    cap && Number(getComputedStyle(cap).opacity) > 0.5
      ? cap.getBoundingClientRect()
      : null;
  const brand = document.getElementById("brand")?.getBoundingClientRect();
  for (const s of shots) {
    const out =
      Math.max(0, -s.x) +
      Math.max(0, -s.y) +
      Math.max(0, s.x + s.w - 1920) +
      Math.max(0, s.y + s.h - 1080);
    if (out > 6)
      add(
        "offscreen",
        `${s.id}(${s.kind}) ${Math.round(out)}px out`,
        Math.min(1, out / 120),
      );
    // Captions are one line at 1500px wide at most; the band they can occupy.
    const band = { x: 210, y: 940, w: 1500, h: 100 };
    const area = inter(
      s,
      capBox
        ? { x: capBox.left, y: capBox.top, w: capBox.width, h: capBox.height }
        : band,
    );
    if (area > 400)
      add(
        "caption",
        `${s.id}(${s.kind}) under the caption`,
        Math.min(1, area / 20000),
      );
    if (
      brand &&
      inter(s, {
        x: brand.left,
        y: brand.top,
        w: brand.width,
        h: brand.height,
      }) > 300
    )
      add("label", `${s.id}(${s.kind}) under the repo label`, 0.5);
  }
  // 3. text cut short inside its element, and text too small to read
  let minText = 99;
  for (const s of shots) {
    if (s.kind === "image" || s.kind === "svg") continue;
    let clipped = 0;
    const walker = document.createTreeWalker(s.el, NodeFilter.SHOW_ELEMENT);
    for (
      let n = walker.currentNode as HTMLElement | null;
      n;
      n = walker.nextNode() as HTMLElement | null
    ) {
      if (
        !n.childNodes.length ||
        ![...n.childNodes].some(
          (c) => c.nodeType === 3 && c.textContent?.trim(),
        )
      )
        continue;
      const cs = getComputedStyle(n);
      if (Number(cs.opacity) < 0.1) continue;
      const px = parseFloat(cs.fontSize) * s.scale;
      if (px < minText) minText = px;
      if (px < 15.5)
        add("tiny", `${s.id}(${s.kind}) text at ${px.toFixed(1)}px`, 0.4);
      if (
        n !== s.el &&
        (cs.overflow === "hidden" || cs.textOverflow === "ellipsis") &&
        n.scrollWidth > n.clientWidth + 8
      )
        clipped++;
      if (
        n !== s.el &&
        n.scrollHeight > n.clientHeight * 1.35 + 4 &&
        cs.overflow === "hidden"
      )
        clipped++;
      if (/…$/.test(n.textContent ?? "") && s.kind !== "tree") clipped += 0.5;
    }
    // Text that spills out of its own element.
    const body = s.el.getBoundingClientRect();
    if (s.kind !== "number")
      for (const n of s.el.querySelectorAll<HTMLElement>("*")) {
        if (!n.textContent?.trim() || n.children.length) continue;
        const r = n.getBoundingClientRect();
        if (
          r.width &&
          (r.right > body.right + 14 || r.bottom > body.bottom + 14) &&
          getComputedStyle(s.el).overflow !== "hidden"
        ) {
          add("spill", `${s.id}(${s.kind}) text spills out`, 0.7);
          break;
        }
      }
    if (clipped >= 1)
      add(
        "clipped",
        `${s.id}(${s.kind}) text cut ×${clipped}`,
        Math.min(1, 0.3 + clipped * 0.2),
      );
  }
  // 4. arrows
  const ends: Record<string, { from: string; to: string }> = {};
  for (const b of spec.beats)
    for (const e of b.elements)
      if (e.kind === "arrow")
        ends[e.id] = { from: String(e.from), to: String(e.to) };
  const segHitsRect = (
    p: number[],
    q: number[],
    r: { x: number; y: number; w: number; h: number },
  ) => {
    const x0 = r.x + 8,
      y0 = r.y + 8,
      x1 = r.x + r.w - 8,
      y1 = r.y + r.h - 8;
    if (x1 <= x0 || y1 <= y0) return false;
    for (let k = 0; k <= 24; k++) {
      const x = p[0]! + ((q[0]! - p[0]!) * k) / 24,
        y = p[1]! + ((q[1]! - p[1]!) * k) / 24;
      if (x > x0 && x < x1 && y > y0 && y < y1) return true;
    }
    return false;
  };
  const arrows: Array<{ id: string; pts: number[][] }> = [];
  for (const svg of scene.querySelectorAll<SVGSVGElement>("svg.wires")) {
    if (opacityOf(svg) < 0.2) continue;
    const path = svg.querySelector("path");
    if (!path) continue;
    const cs = getComputedStyle(path);
    if (
      Number(cs.opacity) < 0.2 ||
      (cs.strokeDasharray === "1px" && parseFloat(cs.strokeDashoffset) > 0.5)
    )
      continue;
    const m = path.getScreenCTM();
    if (!m) continue;
    const nums =
      (path.getAttribute("d") ?? "").match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const pts: number[][] = [];
    for (let i = 0; i + 1 < nums.length; i += 2)
      pts.push([
        m.a * nums[i]! + m.c * nums[i + 1]! + m.e,
        m.b * nums[i]! + m.d * nums[i + 1]! + m.f,
      ]);
    const id = svg.getAttribute("data-id") ?? "";
    arrows.push({ id, pts });
    const len = pts
      .slice(1)
      .reduce(
        (sum, p, i) =>
          sum + Math.hypot(p[0]! - pts[i]![0]!, p[1]! - pts[i]![1]!),
        0,
      );
    if (len < 34) add("arrow", `${id} is a ${Math.round(len)}px stub`, 0.5);
    const mine = ends[id];
    for (const s of shots) {
      if (s.kind === "browser") continue;
      const isEnd = mine && (s.id === mine.from || s.id === mine.to);
      // Through its own end means the two ends overlap or the route doubles back.
      for (let i = 1; i < pts.length; i++)
        if (
          segHitsRect(
            pts[i - 1]!,
            pts[i]!,
            isEnd ? { x: s.x + 14, y: s.y + 14, w: s.w - 28, h: s.h - 28 } : s,
          )
        ) {
          add(
            "arrow",
            `${id} runs through ${s.id}(${s.kind})${isEnd ? " (its own end)" : ""}`,
            0.8,
          );
          break;
        }
    }
  }
  // arrow labels over cards
  for (const lab of scene.querySelectorAll<HTMLElement>("div.mono > span")) {
    const host = lab.parentElement!;
    if (host.closest(".shot") || opacityOf(host) < 0.2) continue;
    const r = lab.getBoundingClientRect();
    for (const s of shots) {
      if (s.kind === "browser") continue;
      if (
        inter(s, { x: r.left, y: r.top, w: r.width, h: r.height }) >
        r.width * r.height * 0.15
      ) {
        add(
          "arrow",
          `label "${lab.textContent}" sits on ${s.id}(${s.kind})`,
          0.6,
        );
        break;
      }
    }
  }
  // 5. how much of the safe area holds something
  const cells = new Set<number>();
  for (const s of shots) {
    if (s.kind === "browser") continue;
    for (
      let gx = Math.max(0, Math.floor(s.x / 40));
      gx < Math.min(48, Math.ceil((s.x + s.w) / 40));
      gx++
    )
      for (
        let gy = Math.max(0, Math.floor(s.y / 40));
        gy < Math.min(27, Math.ceil((s.y + s.h) / 40));
        gy++
      )
        cells.add(gx * 100 + gy);
  }
  const coverage = cells.size / (48 * 27);
  if (shots.length && coverage < 0.1)
    add(
      "thin",
      `only ${Math.round(coverage * 100)}% of the frame is used`,
      0.6,
    );
  if (shots.length > 9)
    add(
      "busy",
      `${shots.length} elements on screen`,
      Math.min(1, (shots.length - 9) / 6),
    );
  return {
    defects,
    coverage,
    count: shots.length,
    minText: Math.round(minText),
  };
}

export async function auditFilm(dir: string, sheets = true) {
  const read = JSON.parse(
    await readFile(join(dir, "artifact.json"), "utf8"),
  ) as VideoArtifact;
  const artifact = held(read);
  const page = await openStage(artifact, sheets ? 0.4 : 0.1);
  const frames = join(dir, "frames");
  if (sheets) {
    await rm(frames, { recursive: true, force: true });
    await mkdir(frames, { recursive: true });
  }
  const defects: Defect[] = [];
  const beats: Array<{ coverage: number; count: number; minText: number }> = [];
  const files: string[] = [];
  for (const [i, b] of artifact.timing.beats.entries()) {
    await seek(page, b.end + HOLD * 0.8);
    const result = await page.evaluate(measure, i, read.plan);
    defects.push(...result.defects);
    beats.push({
      coverage: result.coverage,
      count: result.count,
      minText: result.minText,
    });
    if (sheets) {
      const file = join(frames, `${String(i).padStart(2, "0")}.jpg`);
      await page.screenshot({
        path: file as `${string}.jpg`,
        type: "jpeg",
        quality: 80,
      });
      files.push(file);
    }
  }
  await page.close();
  if (sheets) {
    for (let i = 0; i < files.length; i += 6)
      tile(files.slice(i, i + 6), 3, join(dir, `sheet-${i / 6}.jpg`));
  }
  // The same collision usually persists across a scene's beats: count each
  // distinct problem once per film, plus a little for every extra beat it stays.
  const seen = new Map<string, number>();
  for (const d of defects)
    seen.set(
      `${d.type}|${d.detail.replace(/\d+%|\d+(\.\d+)?px/g, "")}`,
      (seen.get(`${d.type}|${d.detail.replace(/\d+%|\d+(\.\d+)?px/g, "")}`) ??
        0) + 1,
    );
  const byType: Record<string, number> = {};
  for (const key of seen.keys())
    byType[key.split("|")[0]!] = (byType[key.split("|")[0]!] ?? 0) + 1;
  const dirtyBeats = new Set(
    defects
      .filter((d) => !["thin", "busy", "tiny"].includes(d.type))
      .map((d) => d.beat),
  ).size;
  const summary = {
    beats: beats.length,
    seconds: Math.round(read.timing.DURATION),
    distinct: seen.size,
    byType,
    dirtyBeats,
    dirtyShare: +(dirtyBeats / beats.length).toFixed(2),
    coverage: +(
      beats.reduce((s, b) => s + b.coverage, 0) / beats.length
    ).toFixed(2),
    warnings: read.stats?.warnings?.length ?? 0,
    cost:
      (read.stats as { plannerCostUsd?: number | null })?.plannerCostUsd ??
      null,
    model: read.stats?.model,
  };
  await writeFile(
    join(dir, "audit.json"),
    JSON.stringify({ summary, defects, beats }, null, 1),
  );
  return summary;
}

if (import.meta.main) {
  const root = process.argv[2]!;
  const sheets = !process.argv.includes("--no-sheets");
  const only = process.argv
    .find((a) => a.startsWith("--only="))
    ?.slice(7)
    .split(",");
  const names = (await readdir(root))
    .filter((n) => !only || only.some((o) => n.includes(o)))
    .sort();
  const rows: Array<Record<string, unknown>> = [];
  for (const name of names) {
    const dir = join(root, name);
    if (!(await readFile(join(dir, "artifact.json")).catch(() => null)))
      continue;
    try {
      const s = await auditFilm(dir, sheets);
      rows.push({
        film: name.slice(0, 34),
        beats: s.beats,
        sec: s.seconds,
        distinct: s.distinct,
        dirty: s.dirtyShare,
        cover: s.coverage,
        ...s.byType,
      });
    } catch (error) {
      console.error(`✗ ${name}`, error);
    }
  }
  console.table(rows);
  const total = (k: string) =>
    rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const types = [
    "overlap",
    "arrow",
    "clipped",
    "spill",
    "caption",
    "label",
    "offscreen",
    "tiny",
    "thin",
    "busy",
  ];
  console.info(
    `films ${rows.length} · distinct defects/film ${(total("distinct") / rows.length).toFixed(1)} · dirty beats ${((100 * total("dirty")) / rows.length).toFixed(0)}% · ` +
      types
        .map((t) => `${t} ${(total(t) / rows.length).toFixed(2)}`)
        .join(" · "),
  );
  await writeFile(
    join(root, "audit-summary.json"),
    JSON.stringify(rows, null, 1),
  );
  await closeBrowser();
}
