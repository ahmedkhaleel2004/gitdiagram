// Scene engine: turns window.SPEC (the model's plan), window.META (repo facts) and
// window.TIMING (narration clock) into one paused, seek-safe GSAP timeline.
// Every beat is a scene; items inside a scene appear on the spoken word the plan cued.
function build() {
  const S = window.SPEC;
  const M = window.META;
  const T = window.TIMING;
  const DUR = T.DURATION;
  const TB = T.beats;
  const NS = "http://www.w3.org/2000/svg";
  const INK = "#17111f";
  const tl = gsap.timeline({ paused: true });
  const SFX = (window.__SFX = []);
  const sfx = (name, t, gain = 0) => SFX.push({ name, t: Number(Math.max(0, t).toFixed(3)), gain });
  const stage = document.getElementById("scenes");

  // ---------- DOM + text helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function h(tag, cls, style, parent, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (style) e.style.cssText = style;
    if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }
  const ctx2d = document.createElement("canvas").getContext("2d");
  function textW(text, font) {
    ctx2d.font = font;
    return ctx2d.measureText(text).width;
  }
  function wrap(text, font, maxW) {
    const out = [];
    let line = "";
    for (const w of String(text).split(/\s+/)) {
      const next = line ? line + " " + w : w;
      if (line && textW(next, font) > maxW) {
        out.push(line);
        line = w;
      } else line = next;
    }
    if (line) out.push(line);
    return out;
  }
  function fit(text, fontFn, maxW, maxLines, max, min) {
    for (let s = max; s > min; s -= 2) if (wrap(text, fontFn(s), maxW).length <= maxLines && textW(String(text).split(/\s+/).sort((a, b) => b.length - a.length)[0] || "", fontFn(s)) <= maxW) return s;
    return min;
  }
  function seeded(seed) {
    let a = 0;
    for (const c of seed) a = (a * 31 + c.charCodeAt(0)) | 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = seeded(M.owner + "/" + M.repo);
  const fmt = (v) => (Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 2 }));
  const icons = {
    check: (c = "#0f7a48") => `<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11 L9 16 L18 6"/></svg>`,
    cross: (c = "#b3263a") => `<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"><path d="M5 5 L17 17 M17 5 L5 17"/></svg>`,
    file: `<svg width="28" height="32" viewBox="0 0 28 32" fill="none" stroke="#17111f" stroke-width="3" stroke-linejoin="round"><path d="M4 3 H17 L24 10 V29 H4 Z" fill="#fdfaff"/><path d="M17 3 V10 H24"/></svg>`,
    folder: `<svg width="34" height="28" viewBox="0 0 40 32" fill="none" stroke="#17111f" stroke-width="3.5" stroke-linejoin="round"><path d="M3 6 A3 3 0 0 1 6 3 H15 L19 8 H34 A3 3 0 0 1 37 11 V26 A3 3 0 0 1 34 29 H6 A3 3 0 0 1 3 26 Z" fill="#dcc2ff"/></svg>`,
    repo: `<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#17111f" stroke-width="2" stroke-linejoin="round"><path d="M5 3.5 A1.5 1.5 0 0 1 6.5 2 H19 V18 H6.5 A1.5 1.5 0 0 0 5 19.5 Z" fill="#dcc2ff"/><path d="M5 19.5 A1.5 1.5 0 0 0 6.5 21 H19 V18"/></svg>`,
    store: `<svg width="22" height="24" viewBox="0 0 22 24" fill="#dcc2ff" stroke="#17111f" stroke-width="2.5"><ellipse cx="11" cy="5" rx="9" ry="3.5"/><path d="M2 5 V19 A9 3.5 0 0 0 20 19 V5" /></svg>`,
    actor: `<svg width="22" height="24" viewBox="0 0 22 24" fill="#dcc2ff" stroke="#17111f" stroke-width="2.5"><circle cx="11" cy="7" r="5"/><path d="M2 23 C2 16 20 16 20 23" /></svg>`,
    glyph: `<svg width="38" height="38" viewBox="0 0 46 46" fill="none" stroke="#17111f" stroke-width="3.5"><rect x="3" y="3" width="16" height="16" rx="3" fill="#bd85fb"/><rect x="27" y="3" width="16" height="16" rx="3" fill="#fdfaff"/><rect x="15" y="27" width="16" height="16" rx="3" fill="#dcc2ff"/><path d="M19 11 H27 M35 19 V23 H23 V27"/></svg>`,
  };

  // ---------- syntax tint for code scenes ----------
  const KW = new Set(
    "const let var function return if else for while do switch case break continue new class extends implements import export from default async await yield try catch finally throw typeof instanceof in of this super null undefined true false def lambda pass raise with as elif not and or is None True False self func package type struct interface map chan go defer select range fn pub impl trait enum mod use match mut ref where crate static public private protected void int string bool readonly abstract override val fun object when".split(" "),
  );
  function tint(line, hashComments) {
    const re = hashComments
      ? /(#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g
      : /(\/\/.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;
    let out = "";
    let last = 0;
    for (const m of line.matchAll(re)) {
      out += esc(line.slice(last, m.index));
      if (m[1]) out += `<span class="tk-c">${esc(m[1])}</span>`;
      else if (m[2]) out += `<span class="tk-s">${esc(m[2])}</span>`;
      else if (m[3]) out += `<span class="tk-n">${esc(m[3])}</span>`;
      else out += KW.has(m[4]) ? `<span class="tk-k">${esc(m[4])}</span>` : esc(m[4]);
      last = m.index + m[0].length;
    }
    return out + esc(line.slice(last));
  }

  // ---------- motion primitives ----------
  function rise(el, t, o = {}) {
    tl.fromTo(el, { opacity: 0, y: o.y ?? 34, x: o.x ?? 0 }, { opacity: o.to ?? 1, y: 0, x: 0, duration: o.d ?? 0.55, ease: o.ease ?? "power3.out" }, t);
  }
  function pop(el, t, o = {}) {
    tl.fromTo(el, { opacity: 0, scale: o.from ?? 0.6, rotation: o.rot0 ?? 0 }, { opacity: 1, scale: 1, rotation: o.rot ?? 0, duration: o.d ?? 0.42, ease: o.ease ?? "back.out(1.8)" }, t);
  }
  function typeIn(el, t, d) {
    const n = Math.max(1, (el.textContent || "").length);
    tl.fromTo(el, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: d, ease: `steps(${n})` }, t);
    tl.set(el, { clipPath: "none" }, t + d + 0.01);
  }
  function grow(el, t, d = 0.35) {
    tl.fromTo(el, { scaleX: 0 }, { scaleX: 1, duration: d, ease: "power3.out" }, t);
  }
  function svgEl(parent) {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("class", "wires");
    parent.appendChild(s);
    return s;
  }
  function edge(svg, pts, o = {}) {
    const color = o.color || INK;
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", "M" + pts.map((q) => q.map((v) => v.toFixed(1)).join(",")).join(" L"));
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", color);
    p.setAttribute("stroke-width", o.width || 3.5);
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    p.setAttribute("pathLength", "1");
    if (o.dashed) {
      p.style.strokeDasharray = "0.02 0.018";
      p.style.opacity = 0;
    } else {
      p.style.strokeDasharray = "1";
      p.style.strokeDashoffset = "1";
    }
    svg.appendChild(p);
    let head = null;
    if (o.head !== false) {
      const [a, b] = pts.slice(-2);
      const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      head = document.createElementNS(NS, "path");
      head.setAttribute("d", "M -13 -8.5 L 1 0 L -13 8.5 Z");
      head.setAttribute("fill", color);
      head.setAttribute("transform", `translate(${b[0]},${b[1]}) rotate(${ang})`);
      head.style.opacity = 0;
      svg.appendChild(head);
    }
    return { p, head, dashed: !!o.dashed };
  }
  function draw(e, t, d = 0.4) {
    if (e.dashed) tl.fromTo(e.p, { opacity: 0 }, { opacity: 1, duration: d }, t);
    else tl.fromTo(e.p, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: d, ease: "power2.inOut" }, t);
    if (e.head) tl.fromTo(e.head, { opacity: 0 }, { opacity: 1, duration: 0.12 }, t + d - 0.1);
  }

  const beats = S.beats;
  const last = beats.length - 1;
  const win = beats.map((b, i) => ({
    tIn: i === 0 ? 0 : TB[i].start - 0.32,
    tOut: i === last ? DUR : TB[i + 1].start - 0.32,
  }));

  // ---------- narration clock ----------
  // Resolve each cue word to when it is spoken in this beat; unmatched cues are spread evenly.
  function cueTimes(bi, cues) {
    const b = TB[bi];
    const ws = b.words;
    let from = 0;
    const out = cues.map((c) => {
      if (!c) return null;
      for (let k = from; k < ws.length; k++) {
        if (ws[k].w === c || (c.length > 3 && ws[k].w.startsWith(c)) || (ws[k].w.length > 3 && c.startsWith(ws[k].w))) {
          from = k + 1;
          return ws[k].s;
        }
      }
      return null;
    });
    const lo = b.start + 0.3;
    const hi = Math.max(lo + 0.6, b.end - 0.25);
    for (let i = 0; i < out.length; i++) {
      if (out[i] != null) continue;
      let p = i - 1;
      while (p >= 0 && out[p] == null) p--;
      let q = i + 1;
      while (q < out.length && out[q] == null) q++;
      const a = p >= 0 ? out[p] : lo;
      const z = q < out.length ? out[q] : hi;
      const span = q - p;
      out[i] = a + ((z - a) * (i - p)) / span;
    }
    // Nothing reveals before the scene has finished entering, or entrance tweens would win.
    const floor = win[bi].tIn + 0.85;
    out[0] = Math.max(out[0] ?? floor, floor);
    for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + 0.14);
    return out;
  }
  const wordTime = (bi, w) => {
    const hit = w && TB[bi].words.find((x) => x.w === String(w).toLowerCase().replace(/[^a-z0-9.#/]/g, ""));
    return hit ? hit.s : null;
  };


  function shell(i) {
    const sec = h("section", "scene", "", stage);
    const inner = h("div", "inner", "", sec);
    const back = svgEl(inner);
    const w = win[i];
    tl.set(sec, { visibility: "visible" }, w.tIn);
    tl.fromTo(inner, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" }, w.tIn);
    tl.fromTo(inner, { scale: 1 }, { scale: 1.018, duration: w.tOut - w.tIn, ease: "none" }, w.tIn);
    if (i !== last) {
      tl.to(inner, { opacity: 0, x: -60, duration: 0.4, ease: "power2.in" }, w.tOut - 0.4);
      tl.set(sec, { visibility: "hidden" }, w.tOut);
    }
    if (i > 0) sfx("whoosh", w.tIn - 0.05, -13);
    return { sec, inner, back, front: null, t0: w.tIn, t1: w.tOut };
  }
  const front = (sh) => sh.front || (sh.front = svgEl(sh.inner));

  // ---------- graph layout (shared by graph + close) ----------
  function layout(nodes, edges, box, dir, nw, nh) {
    const ids = nodes.map((n) => n.id);
    const out = Object.fromEntries(ids.map((id) => [id, []]));
    edges.forEach((e) => out[e.from] && out[e.from].push(e.to));
    const state = {};
    const back = new Set();
    const visit = (u) => {
      state[u] = 1;
      for (const v of out[u]) {
        if (state[v] === 1) back.add(u + ">" + v);
        else if (!state[v]) visit(v);
      }
      state[u] = 2;
    };
    ids.forEach((id) => !state[id] && visit(id));
    const fwd = edges.filter((e) => !back.has(e.from + ">" + e.to));
    const layer = Object.fromEntries(ids.map((id) => [id, 0]));
    for (let k = 0; k < ids.length; k++) fwd.forEach((e) => (layer[e.to] = Math.max(layer[e.to], layer[e.from] + 1)));
    const L = Math.max(...Object.values(layer)) + 1;
    const cols = Array.from({ length: L }, () => []);
    nodes.forEach((n) => cols[layer[n.id]].push(n));
    cols.forEach((c) => c.sort((a, b) => String(a.group).localeCompare(String(b.group))));
    const pos = {};
    const along = dir === "LR" ? box.w : box.h;
    const across = dir === "LR" ? box.h : box.w;
    const band = Math.min(along / L, dir === "LR" ? 520 : 230);
    const offset = (along - band * L) / 2;
    const w = dir === "LR" ? Math.min(nw, band - 70) : nw;
    const hh = dir === "LR" ? nh : Math.min(nh, band - 44);
    cols.forEach((c, l) => {
      const m = c.length;
      const slot = Math.min((dir === "LR" ? hh : w) + (dir === "LR" ? 56 : 40), across / m);
      const start = (across - slot * m) / 2;
      c.forEach((n, k) => {
        if (dir === "LR") {
          pos[n.id] = { x: box.x + offset + band * l + (band - w) / 2, y: box.y + start + slot * k + (slot - hh) / 2, w, h: hh, layer: l };
        } else {
          const ww = Math.min(w, slot - 30);
          pos[n.id] = { x: box.x + start + slot * k + (slot - ww) / 2, y: box.y + offset + band * l + (band - hh) / 2, w: ww, h: hh, layer: l };
        }
      });
    });
    return pos;
  }
  function routes(edges, pos, dir) {
    const maxB = Math.max(...Object.values(pos).map((p) => p.y + p.h));
    const maxR = Math.max(...Object.values(pos).map((p) => p.x + p.w));
    return edges.map((e) => {
      const a = pos[e.from];
      const b = pos[e.to];
      let pts;
      if (dir === "LR" && b.layer > a.layer) {
        const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
        pts = Math.abs(y1 - y2) < 2 ? [[x1, y1], [x2, y2]] : [[x1, y1], [mx, y1], [mx, y2], [x2, y2]];
      } else if (dir === "TB" && b.layer > a.layer) {
        const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y, my = (y1 + y2) / 2;
        pts = Math.abs(x1 - x2) < 2 ? [[x1, y1], [x2, y2]] : [[x1, y1], [x1, my], [x2, my], [x2, y2]];
      } else if (dir === "LR") {
        const y = maxB + 34;
        pts = [[a.x + a.w / 2, a.y + a.h], [a.x + a.w / 2, y], [b.x + b.w / 2, y], [b.x + b.w / 2, b.y + b.h]];
      } else {
        const x = maxR + 34;
        pts = [[a.x + a.w, a.y + a.h / 2], [x, a.y + a.h / 2], [x, b.y + b.h / 2], [b.x + b.w, b.y + b.h / 2]];
      }
      return { e, pts };
    });
  }
  function nodeEl(parent, n, p, o = {}) {
    const kind = n.kind || "box";
    const cls = "node" + (kind === "external" ? " ext" : "") + (o.cls ? " " + o.cls : "");
    const icon = kind === "store" ? icons.store : kind === "actor" ? icons.actor : "";
    const el = h("div", cls, `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;font-size:${o.size || 26}px`, parent);
    el.innerHTML = `<div class="nl">${icon}<span>${esc(n.label)}</span></div>${n.sub ? `<small>${esc(n.sub)}</small>` : ""}`;
    return el;
  }
  function groupBoxes(parent, groups, nodes, pos) {
    const boxes = [];
    for (const g of groups || []) {
      const mem = nodes.filter((n) => n.group === g.id && pos[n.id]).map((n) => pos[n.id]);
      if (!mem.length) continue;
      const x0 = Math.min(...mem.map((p) => p.x)) - 24;
      const y0 = Math.min(...mem.map((p) => p.y)) - 46;
      const x1 = Math.max(...mem.map((p) => p.x + p.w)) + 24;
      const y1 = Math.max(...mem.map((p) => p.y + p.h)) + 24;
      boxes.push({ g, x0, y0, x1, y1, members: new Set(nodes.filter((n) => n.group === g.id).map((n) => n.id)) });
    }
    const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    const clash = boxes.some((a, i) =>
      boxes.some((b, j) => i < j && hit(a, b)) ||
      nodes.some((n) => !a.members.has(n.id) && pos[n.id] && hit(a, { x0: pos[n.id].x, y0: pos[n.id].y, x1: pos[n.id].x + pos[n.id].w, y1: pos[n.id].y + pos[n.id].h })),
    );
    if (clash) return [];
    return boxes.map((b) => {
      const el = h("div", "group", `left:${b.x0}px;top:${b.y0}px;width:${b.x1 - b.x0}px;height:${b.y1 - b.y0}px`, parent);
      h("div", "group-tag", "", el, esc(b.g.label));
      return el;
    });
  }

  // ---------- scenes ----------
  const scenes = {
    hook(sh, i, s) {
      const card = h("div", "card", "left:120px;top:300px;width:600px;height:380px;padding:34px 38px", sh.inner);
      const nameSize = fit(M.repo, (z) => `750 ${z}px Geist`, 520, 1, 56, 30);
      card.innerHTML = `${icons.repo}
        <div style="font:400 26px/1.2 Geist;color:var(--ink-2);margin-top:18px">${esc(M.owner)} /</div>
        <div style="font:750 ${nameSize}px/1.1 Geist;letter-spacing:-0.02em;white-space:nowrap">${esc(M.repo)}</div>
        <div class="clamp3" style="font:400 24px/1.35 Geist;color:var(--ink-2);margin-top:14px">${esc(M.description)}</div>
        <div class="mono" style="position:absolute;left:38px;bottom:28px;display:flex;gap:26px;font:600 22px/1 'Geist Mono'">
          <span>★ ${esc(fmt(M.stars))}</span>${M.language ? `<span style="display:flex;align-items:center;gap:10px"><i style="display:block;width:16px;height:16px;border-radius:50%;background:var(--purple);border:3px solid var(--ink)"></i>${esc(M.language)}</span>` : ""}
        </div>`;
      rise(card, sh.t0 + 0.2, { x: -40, y: 0 });
      const size = fit(S.hook, (z) => `400 ${z}px "Instrument Serif"`, 1000, 2, 116, 56);
      const head = h("div", "serif", `position:absolute;left:800px;top:190px;width:1000px;font-size:${size}px;line-height:1.02;letter-spacing:-0.02em`, sh.inner);
      String(S.hook)
        .split(/\s+/)
        .forEach((w, k) => {
          const sp = h("span", "hw", "", head, esc(w));
          head.appendChild(document.createTextNode(" "));
          tl.fromTo(sp, { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, sh.t0 + 0.45 + k * 0.07);
        });
      // Scattered dots settle into a map of the project's real parts.
      const comps = s.components.length ? s.components : [M.repo];
      const n = comps.length;
      const cols = n <= 4 ? 2 : 3;
      const rows = Math.ceil(n / cols);
      const nw = cols === 3 ? 290 : 400;
      const gx = (980 - cols * nw) / (cols - 1 || 1);
      const top = 250 + (size * 1.02 * wrap(S.hook, `400 ${size}px "Instrument Serif"`, 1000).length) + 70;
      const nh = 72;
      const gy = 44;
      const tSnap = TB[i].start + 0.5 * (TB[i].end - TB[i].start);
      const posn = comps.map((_, k) => ({ x: 800 + (k % cols) * (nw + gx), y: top + Math.floor(k / cols) * (nh + gy) }));
      comps.forEach((c, k) => {
        const p = posn[k];
        const dot = h("div", "", `position:absolute;left:${p.x + nw / 2 - 12}px;top:${p.y + nh / 2 - 12}px;width:24px;height:24px;border-radius:50%;background:var(--purple-deep);border:3px solid var(--ink)`, sh.inner);
        const sx = 820 + rand() * 940 - (p.x + nw / 2);
        const sy = top - 40 + rand() * (rows * (nh + gy) + 60) - (p.y + nh / 2);
        tl.fromTo(dot, { x: sx, y: sy, scale: 0 }, { scale: 1, duration: 0.35, ease: "back.out(3)" }, sh.t0 + 0.6 + k * 0.08);
        tl.to(dot, { x: sx + (rand() - 0.5) * 60, y: sy + (rand() - 0.5) * 40, duration: Math.max(0.5, tSnap - sh.t0 - 1), ease: "sine.inOut" }, sh.t0 + 1);
        tl.to(dot, { x: 0, y: 0, duration: 0.7, ease: "power3.inOut" }, tSnap + k * 0.04);
        tl.to(dot, { opacity: 0, scale: 2.4, duration: 0.18 }, tSnap + k * 0.04 + 0.62);
        const node = h("div", "node" + (k === 0 ? " purple" : ""), `left:${p.x}px;top:${p.y}px;width:${nw}px;height:${nh}px;font:600 23px/1 'Geist Mono';align-items:center;padding:0 16px`, sh.inner);
        node.innerHTML = `<div class="nl">${esc(c)}</div>`;
        pop(node, tSnap + k * 0.04 + 0.6, { from: 0.4 });
      });
      for (let k = 0; k < n; k++) {
        const a = posn[k];
        if ((k + 1) % cols !== 0 && k + 1 < n) draw(edge(sh.back, [[a.x + nw, a.y + nh / 2], [a.x + nw + gx, a.y + nh / 2]], { width: 3 }), tSnap + 0.95 + k * 0.05, 0.3);
        if (k + cols < n && k % cols === 0) draw(edge(sh.back, [[a.x + nw / 2, a.y + nh], [a.x + nw / 2, a.y + nh + gy]], { width: 3 }), tSnap + 1 + k * 0.05, 0.3);
      }
      sfx("paper", sh.t0 + 0.15, -16);
      sfx("tick", sh.t0 + 0.62, -16);
      sfx("whoosh", tSnap - 0.05, -10);
      sfx("pop", tSnap + 0.62, -8);
    },

    stack(sh, i, s) {
      const nF = Math.max(1, s.folders.length);
      const rhF = Math.min(100, 640 / nF);
      const wh = Math.max(440, 76 + nF * rhF + 110);
      const wt = 150 + (780 - wh) / 2;
      const win = h("div", "card", `left:120px;top:${wt}px;width:1680px;height:${wh}px`, sh.inner);
      const bar = h("div", "panel-head", "height:76px;gap:18px;letter-spacing:0", win);
      bar.innerHTML = `<div class="dots"><i></i><i></i><i></i></div><span style="font:600 24px/1 'Geist Mono';color:var(--ink)">${esc(M.owner)}/${esc(M.repo)}</span>`;
      rise(win, sh.t0 + 0.05, { y: 40 });
      s.badges.forEach((b, k) => {
        const pill = h("span", "pill static", `height:42px;padding:0 16px;font:650 20px/1 'Geist Mono';color:var(--ink);box-shadow:3px 3px 0 var(--ink);background:${k === 0 ? "var(--purple)" : "var(--card)"}`, bar, esc(b));
        pop(pill, sh.t0 + 0.45 + k * 0.12);
      });
      if (s.badges.length) sfx("pop", sh.t0 + 0.45, -11);
      const n = nF;
      const rh = rhF;
      const y0 = wt + 76 + (wh - 76 - rh * n) / 2;
      const times = cueTimes(i, s.folders.map((f) => f.cue));
      s.folders.forEach((f, k) => {
        const y = y0 + k * rh;
        const hl = h("div", "hl", `left:146px;top:${y + 8}px;width:1628px;height:${rh - 16}px`, sh.inner);
        const row = h("div", "", `position:absolute;left:180px;top:${y}px;width:1580px;height:${rh}px;display:flex;align-items:center;gap:18px`, sh.inner);
        const isFile = /\.[a-z0-9]+$/i.test(f.path.split("/").pop());
        row.innerHTML = `${isFile ? icons.file : icons.folder}<span class="mono" style="font:650 30px/1 'Geist Mono';width:620px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(f.path)}</span><span class="note" style="font:400 28px/1.2 Geist;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:860px">${esc(f.note)}</span>`;
        rise(row, sh.t0 + 0.3 + k * 0.07, { x: -24, y: 0, d: 0.4, to: 0.5 });
        grow(hl, times[k] - 0.05);
        tl.to(row, { opacity: 1, duration: 0.25 }, times[k] - 0.05);
        tl.to(row.querySelector(".note"), { color: INK, duration: 0.25 }, times[k] - 0.05);
        if (k > 0) tl.to(sh.inner.querySelectorAll(".hl")[k - 1], { opacity: 0.4, duration: 0.3 }, times[k]);
        sfx("tick", times[k] - 0.05, -12);
      });
    },

    tree(sh, i, s) {
      const n = Math.max(1, s.rows.length);
      const lh = Math.min(58, 660 / n);
      const longest = Math.max(...s.rows.map((r) => r.path.length), 10);
      const fs = longest > 40 ? 21 : longest > 34 ? 23 : 25;
      const ph = Math.max(480, 60 + n * lh + 100);
      const pt = 150 + (780 - ph) / 2;
      const panel = h("div", "card", `left:120px;top:${pt}px;width:900px;height:${ph}px`, sh.inner);
      h("div", "panel-head", "", panel, `${esc(M.owner)}/${esc(M.repo)}`);
      rise(panel, sh.t0 + 0.05, { y: 40 });
      const y0 = pt + 60 + (ph - 60 - lh * n) / 2;
      const cued = s.rows.map((r, k) => ({ r, k })).filter((x) => x.r.cue || x.r.note);
      const times = cueTimes(i, cued.map((x) => x.r.cue));
      const c = Math.max(1, cued.length);
      const ch = Math.min(124, (780 - (c - 1) * 16) / c);
      const hls = {};
      cued.forEach(({ k }) => (hls[k] = h("div", "hl", `left:136px;top:${y0 + k * lh + 3}px;width:868px;height:${lh - 6}px`, sh.inner)));
      s.rows.forEach((r, k) => {
        const ln = h("div", "mono", `position:absolute;left:170px;top:${y0 + k * lh}px;height:${lh}px;display:flex;align-items:center;font:${r.cue || r.note ? 600 : 400} ${fs}px/1 'Geist Mono';white-space:nowrap;color:${r.cue || r.note ? INK : "var(--ink-2)"}`, sh.inner, esc(r.path));
        rise(ln, sh.t0 + 0.3 + k * 0.05, { x: -16, y: 0, d: 0.3, ease: "power2.out" });
      });
      let floor = 150;
      cued.forEach(({ r, k }, j) => {
        const t = times[j];
        const ry0 = y0 + k * lh + lh / 2;
        const cy = Math.min(Math.max(ry0 - ch / 2, floor), 930 - ch * (c - j) - 16 * (c - j - 1));
        floor = cy + ch + 16;
        const card = h("div", "card", `left:1080px;top:${cy}px;width:720px;height:${ch}px;padding:0 28px;display:flex;flex-direction:column;justify-content:center;box-shadow:6px 6px 0 var(--ink)`, sh.inner);
        card.innerHTML = `<div class="mono" style="font:650 22px/1.1 'Geist Mono';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.path.split("/").pop())}</div>${r.note ? `<div class="${ch > 100 ? "clamp2" : "clamp2"}" style="font:400 ${ch > 90 ? 27 : 23}px/1.25 Geist;color:var(--ink-2);margin-top:8px">${esc(r.note)}</div>` : ""}`;
        grow(hls[k], t - 0.05);
        rise(card, t, { x: 40, y: 0, d: 0.45 });
        const ry = y0 + k * lh + lh / 2;
        draw(edge(front(sh), [[1008, ry], [1044, ry], [1044, cy + ch / 2], [1076, cy + ch / 2]], { width: 3, head: false, color: "#7a2be0" }), t + 0.05, 0.3);
        sfx("tick", t - 0.05, -13);
      });
    },

    flow(sh, i, s) {
      const tSize = fit(s.title, (z) => `italic 400 ${z}px "Instrument Serif"`, 1680, 1, 76, 44);
      const title = h("div", "serif it", `position:absolute;left:120px;top:200px;width:1680px;font-size:${tSize}px;line-height:1;letter-spacing:-0.01em`, sh.inner, esc(s.title));
      rise(title, sh.t0 + 0.1, { y: 24 });
      const n = Math.max(1, s.steps.length);
      const gap = 74;
      const nw = Math.min(330, (1680 - (n - 1) * gap) / n);
      const x0 = 120 + (1680 - (n * nw + (n - 1) * gap)) / 2;
      const y = 430;
      const nh = 220;
      const times = cueTimes(i, s.steps.map((x) => x.cue));
      const marker = h("div", "", `position:absolute;left:${x0 + nw / 2 - 22}px;top:${y - 70}px;width:44px;height:44px`, sh.inner, `<svg width="44" height="44" viewBox="0 0 44 44"><path d="M6 8 H38 L22 34 Z" fill="#7a2be0" stroke="#17111f" stroke-width="3.5" stroke-linejoin="round"/></svg>`);
      const nodes = s.steps.map((st, k) => {
        const x = x0 + k * (nw + gap);
        const el = h("div", "node", `left:${x}px;top:${y}px;width:${nw}px;height:${nh}px;justify-content:space-between;padding:22px 22px;border-radius:18px;box-shadow:7px 7px 0 var(--ink)`, sh.inner);
        const ls = fit(st.label, (z) => `680 ${z}px Geist`, nw - 44, 2, 32, 20);
        const ds = fit(st.detail, (z) => `500 ${z}px "Geist Mono"`, nw - 44, 1, 20, 13);
        el.innerHTML = `<div class="mono" style="font:600 20px/1 'Geist Mono';color:var(--ink-2)">${String(k + 1).padStart(2, "0")}</div>
          <div class="clamp2" style="font:680 ${ls}px/1.15 Geist;letter-spacing:-0.01em">${esc(st.label)}</div>
          <div class="mono" style="font:500 ${ds}px/1.3 'Geist Mono';color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(st.detail)}</div>`;
        rise(el, sh.t0 + 0.25 + k * 0.06, { y: 30, to: 0.45, d: 0.45 });
        return { el, x };
      });
      nodes.forEach((nd, k) => {
        const t = times[k];
        if (k > 0) draw(edge(sh.back, [[nodes[k - 1].x + nw + 8, y + nh / 2], [nd.x - 10, y + nh / 2]], { width: 4 }), t - 0.3, 0.3);
        tl.to(nd.el, { opacity: 1, backgroundColor: "#bd85fb", duration: 0.25 }, t - 0.05);
        tl.fromTo(nd.el, { scale: 1 }, { scale: 1.06, duration: 0.14, yoyo: true, repeat: 1, ease: "power2.out", immediateRender: false }, t - 0.05);
        if (k > 0) tl.to(nodes[k - 1].el, { backgroundColor: "#e6d5ff", duration: 0.3 }, t - 0.05);
        if (k === 0) pop(marker, t - 0.1, { from: 0.3 });
        else tl.to(marker, { x: nd.x - x0, duration: 0.45, ease: "power3.inOut" }, t - 0.35);
        sfx("pop", t - 0.05, -11);
      });
    },

    code(sh, i, s) {
      const n = Math.max(1, s.lines.length);
      const lh = Math.min(48, 640 / n);
      const longest = Math.max(...s.lines.map((l) => l.length), 10);
      const fs = Math.min(25, Math.floor(1000 / (longest * 0.6)));
      const ph = Math.max(420, 60 + n * lh + 90);
      const pt = 150 + (780 - ph) / 2;
      const panel = h("div", "card", `left:120px;top:${pt}px;width:1120px;height:${ph}px`, sh.inner);
      h("div", "panel-head", "", panel, esc(s.path));
      rise(panel, sh.t0 + 0.05, { y: 40 });
      const y0 = pt + 60 + (ph - 60 - lh * n) / 2;
      const hash = /\.(py|rb|sh|ex|exs|r|jl|pl|toml|ya?ml)$/i.test(s.path);
      const times = cueTimes(i, s.highlights.map((x) => x.cue));
      s.highlights.forEach((hlt, k) => {
        const bar = h("div", "hl", `left:134px;top:${y0 + (hlt.line - 1) * lh}px;width:1092px;height:${lh}px`, sh.inner);
        grow(bar, times[k] - 0.05);
        if (k > 0) tl.to(sh.inner.querySelectorAll(".hl")[k - 1], { opacity: 0.35, duration: 0.3 }, times[k]);
      });
      s.lines.forEach((l, k) => {
        const y = y0 + k * lh;
        h("div", "mono", `position:absolute;left:140px;top:${y}px;width:46px;height:${lh}px;display:flex;align-items:center;justify-content:flex-end;font:400 ${fs - 4}px/1 'Geist Mono';color:rgba(78,68,99,0.65)`, sh.inner, String(k + 1));
        const ln = h("div", "code", `position:absolute;left:210px;top:${y}px;height:${lh}px;line-height:${lh}px;font-size:${fs}px;white-space:pre;width:max-content`, sh.inner, l.trim() === "…" ? `<span class="tk-c">${esc(l)}</span>` : tint(l, hash));
        typeIn(ln, sh.t0 + 0.35 + k * 0.08, Math.min(0.35, 0.05 + l.length * 0.008));
      });
      sfx("typing", sh.t0 + 0.35, -15);
      // Callouts sit beside their lines, pushed apart so they never overlap.
      let floor = 150;
      s.highlights.forEach((hlt, k) => {
        const ly = y0 + (hlt.line - 1) * lh + lh / 2;
        const chh = 132;
        const cy = Math.min(Math.max(ly - chh / 2, floor, 150), 930 - chh * (s.highlights.length - k) - 18 * (s.highlights.length - k - 1));
        floor = cy + chh + 18;
        const card = h("div", "card", `left:1300px;top:${cy}px;width:500px;height:${chh}px;padding:0 26px;display:flex;flex-direction:column;justify-content:center;box-shadow:6px 6px 0 var(--ink)`, sh.inner);
        card.innerHTML = `<div class="mono" style="font:600 18px/1 'Geist Mono';color:var(--purple-deep)">LINE ${hlt.line}</div><div class="clamp2" style="font:500 27px/1.2 Geist;margin-top:10px">${esc(hlt.note)}</div>`;
        rise(card, times[k], { x: 40, y: 0, d: 0.45 });
        draw(edge(front(sh), [[1232, ly], [1266, ly], [1266, cy + chh / 2], [1296, cy + chh / 2]], { width: 3, head: false, color: "#7a2be0" }), times[k] + 0.05, 0.3);
        sfx("tick", times[k] - 0.05, -10);
      });
    },

    graph(sh, i, s) {
      const tSize = fit(s.title, (z) => `italic 400 ${z}px "Instrument Serif"`, 1680, 1, 64, 40);
      const title = h("div", "serif it", `position:absolute;left:120px;top:160px;font-size:${tSize}px;line-height:1;white-space:nowrap`, sh.inner, esc(s.title));
      rise(title, sh.t0 + 0.1, { y: 20 });
      const few = s.nodes.length <= 4 ? 0 : s.nodes.length <= 6 ? 1 : 2;
      const pos = layout(s.nodes, s.edges, { x: 120, y: 270, w: 1680, h: 640 }, "LR", [350, 310, 290][few], [128, 112, 100][few]);
      const groups = groupBoxes(sh.inner, s.groups, s.nodes, pos);
      groups.forEach((g) => pop(g, sh.t0 + 0.3, { from: 0.96, ease: "power3.out" }));
      const times = cueTimes(i, s.nodes.map((x) => x.cue));
      const at = {};
      s.nodes.forEach((n, k) => {
        const el = nodeEl(sh.inner, n, pos[n.id], { size: [31, 28, 26][few], cls: n.kind === "actor" || n.kind === "store" ? "tint" : "" });
        at[n.id] = times[k];
        pop(el, times[k] - 0.05);
        if (k < 3 || k % 2 === 0) sfx("pop", times[k] - 0.05, -12);
      });
      routes(s.edges, pos, "LR").forEach(({ e, pts }) => {
        const t = Math.max(at[e.from], at[e.to]) + 0.1;
        draw(edge(sh.back, pts, { width: 3.5 }), t, 0.35);
        if (e.label) {
          const mid = pts[Math.floor((pts.length - 1) / 2)];
          const nxt = pts[Math.floor((pts.length - 1) / 2) + 1];
          const lx = (mid[0] + nxt[0]) / 2;
          const ly = (mid[1] + nxt[1]) / 2;
          const lab = h("div", "mono", `position:absolute;left:${lx - 110}px;top:${ly - 16}px;width:220px;text-align:center;font:600 18px/32px 'Geist Mono';color:var(--ink-2)`, sh.inner, `<span style="background:var(--paper);padding:2px 8px;border-radius:6px">${esc(e.label)}</span>`);
          rise(lab, t + 0.25, { y: 8, d: 0.3 });
        }
      });
    },

    checklist(sh, i, s) {
      const n = Math.max(1, s.items.length);
      const rh = Math.min(104, 560 / n);
      const ph = Math.max(460, 150 + n * rh + 60);
      const pt = 150 + (780 - ph) / 2;
      const panel = h("div", "card", `left:120px;top:${pt}px;width:1080px;height:${ph}px;padding:44px 50px`, sh.inner);
      h("div", "", "font:720 42px/1.1 Geist;letter-spacing:-0.015em", panel, esc(s.title));
      rise(panel, sh.t0 + 0.05, { y: 40 });
      const times = cueTimes(i, s.items.map((x) => x.cue));
      s.items.forEach((it, k) => {
        const y = pt + 150 + k * rh;
        const ring = h("div", "badge", `left:176px;top:${y + rh / 2 - 22}px;background:var(--card);box-shadow:none`, sh.inner);
        const txt = h("div", "", `position:absolute;left:250px;top:${y}px;height:${rh}px;width:900px;display:flex;align-items:center;font:500 32px/1.2 Geist;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`, sh.inner, esc(it.text));
        rise(ring, sh.t0 + 0.3 + k * 0.06, { y: 10, d: 0.3 });
        rise(txt, sh.t0 + 0.32 + k * 0.06, { x: -16, y: 0, d: 0.35, to: 0.55 });
        const b = h("div", "badge " + (it.ok ? "ok" : "bad"), `left:176px;top:${y + rh / 2 - 22}px`, sh.inner, it.ok ? icons.check() : icons.cross());
        pop(b, times[k] - 0.05, { from: 0.2, ease: "back.out(3)" });
        tl.to(txt, { opacity: 1, color: it.ok ? INK : "#b3263a", duration: 0.25 }, times[k] - 0.05);
        if (!it.ok) {
          const strike = h("div", "", `position:absolute;left:250px;top:${y + rh / 2}px;width:${Math.min(880, textW(it.text, "500 32px Geist"))}px;height:3px;background:var(--red);transform-origin:left center`, sh.inner);
          grow(strike, times[k] + 0.1, 0.3);
        }
        sfx(it.ok ? "tick" : "reject", times[k] - 0.05, it.ok ? -11 : -6);
      });
      const ok = s.items.filter((x) => x.ok).length;
      const allOk = ok === s.items.length;
      const tV = Math.min(times[times.length - 1] + 0.45, win[i].tOut - 1.1);
      const count = h("div", "mono", `position:absolute;left:1290px;top:${pt + 180}px;font:600 24px/1 'Geist Mono';letter-spacing:0.08em;color:var(--ink-2)`, sh.inner, `${ok} / ${s.items.length} PASS`);
      rise(count, tV - 0.2, { y: 12, d: 0.35 });
      const color = allOk ? "var(--green)" : "var(--red)";
      const stamp = h("div", "", `position:absolute;left:1290px;top:${pt + 250}px;padding:18px 32px;border:7px solid ${color};border-radius:16px;color:${color};font:820 ${fit(s.verdict || (allOk ? "ACCEPTED" : "REJECTED"), (z) => `820 ${z}px Geist`, 430, 1, 66, 30)}px/1 Geist;letter-spacing:0.04em;background:${allOk ? "rgba(207,242,222,0.8)" : "rgba(255,217,218,0.85)"};white-space:nowrap`, sh.inner, esc(s.verdict || (allOk ? "ACCEPTED" : "REJECTED")));
      tl.fromTo(stamp, { opacity: 0, scale: 1.8, rotation: -14 }, { opacity: 1, scale: 1, rotation: -6, duration: 0.22, ease: "power4.in" }, tV);
      sfx("stamp", tV + 0.16, -3);
    },

    stream(sh, i, s) {
      const L = { x: 200, c: 400 };
      const R = { x: 1320, c: 1520 };
      [
        [s.left, L],
        [s.right, R],
      ].forEach(([ep, p], k) => {
        const card = h("div", "card", `left:${p.x}px;top:150px;width:400px;height:128px;padding:0 28px;display:flex;flex-direction:column;justify-content:center;background:${k ? "var(--purple-soft)" : "var(--card)"}`, sh.inner);
        card.innerHTML = `<div style="font:720 36px/1.1 Geist;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ep.label)}</div><div class="mono" style="font:500 20px/1.2 'Geist Mono';color:var(--ink-2);margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ep.sub)}</div>`;
        rise(card, sh.t0 + 0.1 + k * 0.12, { y: 30 });
        const life = edge(sh.back, [[p.c, 290], [p.c, 925]], { dashed: true, head: false, width: 3, color: "#4e4463" });
        draw(life, sh.t0 + 0.4, 0.4);
      });
      const n = Math.max(1, s.messages.length);
      const sp = Math.min(92, 580 / n);
      const times = cueTimes(i, s.messages.map((x) => x.cue));
      s.messages.forEach((m, k) => {
        const y = 360 + k * sp;
        const toRight = m.dir !== "left";
        const pts = toRight ? [[L.c + 6, y], [R.c - 8, y]] : [[R.c - 6, y], [L.c + 8, y]];
        draw(edge(sh.back, pts, { width: 4, color: toRight ? INK : "#7a2be0" }), times[k] - 0.05, 0.4);
        const chip = h("div", "pill", `left:960px;top:${y - 28}px;height:${Math.min(48, sp - 14)}px;transform-origin:center;font:600 ${sp < 70 ? 18 : 21}px/1 'Geist Mono';box-shadow:3px 3px 0 var(--ink);background:${toRight ? "var(--card)" : "var(--purple-soft)"}`, sh.inner, esc(m.text));
        chip.style.left = 960 - Math.min(760, textW(m.text, `600 ${sp < 70 ? 18 : 21}px "Geist Mono"`) + 50) / 2 + "px";
        tl.fromTo(chip, { opacity: 0, x: toRight ? -120 : 120 }, { opacity: 1, x: 0, duration: 0.45, ease: "power3.out" }, times[k] - 0.05);
        sfx("blip", times[k] - 0.05, -14);
      });
    },

    stats(sh, i, s) {
      const n = Math.max(1, s.items.length);
      const gap = 40;
      const cw = (1680 - (n - 1) * gap) / n;
      const times = cueTimes(i, s.items.map((x) => x.cue));
      s.items.forEach((it, k) => {
        const x = 120 + k * (cw + gap);
        const card = h("div", "card", `left:${x}px;top:250px;width:${cw}px;height:500px;padding:40px 40px;display:flex;flex-direction:column;justify-content:flex-end`, sh.inner);
        rise(card, sh.t0 + 0.1 + k * 0.08, { y: 40 });
        const str = fmt(it.value);
        const size = fit(str + (it.suffix || ""), (z) => `400 ${z}px "Instrument Serif"`, cw - 80, 1, 190, 60);
        const num = h("div", "serif", `display:flex;align-items:flex-end;font-size:${size}px;line-height:1;height:${size}px;letter-spacing:-0.02em`, card);
        [...str].forEach((ch, j) => {
          if (!/\d/.test(ch)) {
            h("span", "", `display:inline-block;height:${size}px`, num, esc(ch));
            return;
          }
          const col = h("span", "digit", `height:${size}px;line-height:${size}px`, num);
          const strip = h("span", "strip", "", col, Array.from({ length: 20 }, (_, d) => `<span style="height:${size}px;display:block">${d % 10}</span>`).join(""));
          // The roll must land before the scene hands off, even when its cue is spoken late.
          const tRoll = Math.min(times[k], win[i].tOut - 1.6);
          tl.fromTo(strip, { y: 0 }, { y: -(10 + Number(ch)) * size, duration: 1.0, ease: "power3.out" }, tRoll + (str.length - j) * 0.04);
        });
        if (it.suffix) h("span", "serif it", `font-size:${Math.round(size * 0.55)}px;line-height:1;margin-left:10px;margin-bottom:${Math.round(size * 0.08)}px;color:var(--purple-deep)`, num, esc(it.suffix));
        h("div", "clamp2", "font:500 30px/1.25 Geist;margin-top:26px;color:var(--ink-2)", card, esc(it.label));
        tl.to(card, { backgroundColor: "#dcc2ff", duration: 0.3 }, times[k] - 0.05);
        sfx("tick", times[k] - 0.05, -10);
      });
    },

    compare(sh, i, s) {
      const times = cueTimes(i, [s.left.cue, s.right.cue]);
      const most = Math.max(s.left.items.length, s.right.items.length, 1);
      const ch = Math.max(440, 92 + 60 + most * 74 + 40);
      const ct = 150 + (780 - ch) / 2;
      [s.left, s.right].forEach((side, k) => {
        const x = k ? 1020 : 120;
        const card = h("div", "card", `left:${x}px;top:${ct}px;width:780px;height:${ch}px;padding:46px 50px;background:${k ? "var(--card)" : "var(--paper-2)"}`, sh.inner);
        h("div", "", `font:720 44px/1.1 Geist;letter-spacing:-0.015em;color:${k ? "var(--purple-deep)" : INK}`, card, esc(side.title));
        side.items.forEach((it, j) => {
          const row = h("div", "", "display:flex;gap:18px;margin-top:34px;font:450 32px/1.25 Geist", card, `<span style="color:var(--purple-deep);font-weight:700">—</span><span>${esc(it)}</span>`);
          rise(row, times[k] + 0.15 + j * 0.12, { x: -14, y: 0, d: 0.35 });
        });
        rise(card, times[k] - 0.1, { y: 40 });
        sfx("paper", times[k] - 0.1, -14);
      });
      const vs = h("div", "serif it", `position:absolute;left:910px;top:${ct + ch / 2 - 50}px;width:100px;height:100px;border-radius:50%;border:4px solid var(--ink);background:var(--purple);display:flex;align-items:center;justify-content:center;font-size:52px;box-shadow:5px 5px 0 var(--ink)`, sh.inner, "vs");
      pop(vs, times[1] - 0.25);
    },

    idea() {},

    close(sh, i) {
      const tw = S.takeaway.length ? S.takeaway : [{ text: M.repo, cue: "" }];
      const times = cueTimes(i, tw.map((x) => x.cue));
      // Prefer each takeaway on one line when it still reads large; wrap only when it must.
      const one = Math.min(...tw.map((t) => fit(t.text, (z) => `400 ${z}px "Instrument Serif"`, 840, 1, 112, 56)));
      let size = one >= 76 ? one : Math.min(...tw.map((t) => fit(t.text, (z) => `400 ${z}px "Instrument Serif"`, 820, 2, 112, 56)));
      const linesAt = (z) => tw.reduce((a, t) => a + wrap(t.text, `400 ${z}px "Instrument Serif"`, 820).length, 0);
      while (size > 56 && linesAt(size) * size * 1.06 > 400) size -= 4;
      let y = 190;
      tw.forEach((t, k) => {
        const lines = wrap(t.text, `400 ${size}px "Instrument Serif"`, 820).length;
        const el = h("div", "serif" + (k ? " it" : ""), `position:absolute;left:116px;top:${y}px;width:840px;font-size:${size}px;line-height:1.04;letter-spacing:-0.02em;color:${k ? "var(--purple-deep)" : INK}`, sh.inner);
        String(t.text)
          .split(/\s+/)
          .forEach((w, j) => {
            const sp = h("span", "hw", "", el, esc(w));
            el.appendChild(document.createTextNode(" "));
            tl.fromTo(sp, { opacity: 0, y: 28 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, times[k] - 0.1 + j * 0.06);
          });
        y += lines * size * 1.06 + 10;
      });
      sfx("check", times[times.length - 1], -9);
      const tS = TB[i].end - Math.min(1.6, (TB[i].end - TB[i].start) * 0.35);
      if (S.startHere.path) {
        const lab = h("div", "label", `left:122px;top:${y + 50}px`, sh.inner, "start reading here");
        rise(lab, tS - 0.15, { y: 12, d: 0.4 });
        const pill = h("div", "pill", `left:116px;top:${y + 90}px;height:76px;padding:0 28px;font:650 30px/1 'Geist Mono';background:var(--purple);box-shadow:6px 6px 0 var(--ink);max-width:840px;overflow:hidden`, sh.inner, `${icons.folder}${esc(S.startHere.path)}`);
        rise(pill, tS, { y: 24, d: 0.5 });
        const files = h("div", "", `position:absolute;left:116px;top:${y + 196}px;width:840px;display:flex;flex-wrap:wrap;gap:14px`, sh.inner);
        let used = 0;
        S.startHere.files.forEach((f, k) => {
          const cw = textW(f, `500 22px "Geist Mono"`) + 52;
          if (used + cw > 840) return;
          used += cw + 14;
          const chip = h("div", "", "border:3px solid var(--ink);border-radius:10px;background:var(--card);box-shadow:3px 3px 0 var(--ink);padding:10px 16px;font:500 22px/1 'Geist Mono'", files, esc(f));
          rise(chip, tS + 0.35 + k * 0.07, { y: 18, d: 0.35 });
        });
        sfx("tick", tS, -10);
      }
      const A = S.architecture;
      if (A.nodes.length) {
        const pos = layout(A.nodes, A.edges, { x: 1000, y: 120, w: 800, h: 800 }, "TB", 250, 88);
        const groups = groupBoxes(sh.inner, A.groups, A.nodes, pos);
        groups.forEach((g) => pop(g, sh.t0 + 0.9, { from: 0.96, ease: "power3.out" }));
        const at = {};
        A.nodes.forEach((n, k) => {
          const el = nodeEl(sh.inner, n, pos[n.id], { size: 23, cls: n.kind === "actor" || n.kind === "store" ? "tint" : "" });
          at[n.id] = sh.t0 + 0.35 + k * 0.08;
          pop(el, at[n.id], { from: 0.5 });
        });
        routes(A.edges, pos, "TB").forEach(({ e, pts }, k) => draw(edge(sh.back, pts, { width: 3.2 }), Math.max(at[e.from], at[e.to]) + 0.35 + k * 0.04, 0.3));
        sfx("pop", sh.t0 + 0.4, -9);
      }
      const sign = h("div", "", "position:absolute;left:120px;top:960px;display:flex;align-items:center;gap:16px", sh.inner, `${icons.glyph}<span class="mono" style="font:600 24px/1 'Geist Mono'">github.com/${esc(M.owner)}/${esc(M.repo)}</span><span style="font:400 22px/1 Geist;color:var(--ink-2);margin-left:8px">· explained by GitDiagram</span>`);
      rise(sign, T.SPEECH_END + 0.3, { y: 16, d: 0.6 });
      sfx("resolve", T.SPEECH_END + 0.25, -6);
    },
  };

  // ---------- ambient background ----------
  tl.fromTo("#bg-grid", { x: 0, y: 0 }, { x: -40, y: -40, duration: DUR, ease: "none" }, 0);
  tl.fromTo("#bg-glow", { scale: 1, opacity: 0.85 }, { scale: 1.12, opacity: 1, duration: 5.5, ease: "sine.inOut", yoyo: true, repeat: Math.max(0, Math.floor(DUR / 5.5) - 1) }, 0);
  tl.fromTo("#bg-glow-2", { x: 0 }, { x: 120, duration: 8, ease: "sine.inOut", yoyo: true, repeat: Math.max(0, Math.floor(DUR / 8) - 1) }, 0);

  // ---------- brand ----------
  const brand = document.getElementById("brand");
  brand.innerHTML = `${icons.glyph}${esc(S.title)} <span>· how it works</span>`;
  rise(brand, 0.3, { y: -16, d: 0.6 });
  tl.to(brand, { opacity: 0, duration: 0.4 }, win[last].tIn);

  // ---------- scenes ----------
  beats.forEach((b, i) => scenes[b.scene.type](shell(i), i, b.scene));

  // ---------- chapter rail ----------
  const chapters = [];
  beats.forEach((b, i) => {
    if (i === 0 || i === last) return;
    if (!chapters.length || chapters.at(-1).name !== b.chapter) chapters.push({ name: b.chapter, i });
  });
  if (chapters.length > 1) {
    const rail = document.getElementById("rail");
    const x0 = chapters.length > 6 ? 200 : 300;
    const x1 = 1920 - x0;
    const xs = chapters.map((_, k) => x0 + ((x1 - x0) * k) / (chapters.length - 1));
    const base = h("div", "", `left:${x0}px;width:${x1 - x0}px`, rail);
    base.id = "rail-base";
    const prog = h("div", "", `left:${x0}px;width:${x1 - x0}px`, rail);
    prog.id = "rail-prog";
    const tA = win[1].tIn;
    tl.fromTo(base, { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, duration: 0.8, ease: "power3.inOut" }, tA);
    tl.fromTo(prog, { scaleX: 0 }, { scaleX: 0, duration: 0.01 }, 0);
    chapters.forEach((c, k) => {
      const st = h("div", "station", `left:${xs[k] - 110}px`, rail, `<i class="sdot"></i><span class="slabel">${esc(c.name)}</span>`);
      rise(st, tA + 0.1 + k * 0.06, { y: 16, d: 0.45 });
      const t = Math.max(win[c.i].tIn + 0.2, tA + 0.6);
      tl.to(prog, { scaleX: k / (chapters.length - 1), duration: 0.6, ease: "power3.inOut" }, t);
      tl.to(st.querySelector(".sdot"), { backgroundColor: "#bd85fb", scale: 1.35, duration: 0.3, ease: "back.out(2)" }, t + 0.25);
      tl.to(st.querySelector(".slabel"), { color: INK, duration: 0.3 }, t + 0.25);
      if (k > 0) tl.to(rail.querySelectorAll(".sdot")[k - 1], { backgroundColor: INK, scale: 1, duration: 0.3 }, t + 0.25);
    });
    tl.to(rail, { opacity: 0, y: 20, duration: 0.4 }, win[last].tIn);
  }

  // ---------- the idea card ----------
  const ideaAt = beats.findIndex((b) => b.scene.type === "idea");
  const note = document.getElementById("note");
  if (S.idea && ideaAt > 0) {
    const emph = String(S.idea.emphasis || "").toLowerCase();
    document.getElementById("note-front").innerHTML = `<div class="serif" style="font-size:420px;line-height:0.8">?</div><div><div class="mono" style="font:700 44px/1 'Geist Mono';letter-spacing:0.1em;text-transform:uppercase">${esc(S.idea.teaser || "the one idea")}</div><div class="serif it" style="font-size:118px;line-height:1;margin-top:18px">coming up</div></div>`;
    const ss = fit(S.idea.statement, (z) => `400 ${z}px "Instrument Serif"`, 1090, 3, 128, 64);
    const words = String(S.idea.statement).split(/\s+/);
    const html = words.map((w) => (emph && w.toLowerCase().replace(/[^a-z0-9]/g, "") === emph.replace(/[^a-z0-9]/g, "") ? `<span class="it" id="emph" style="color:var(--purple-deep);position:relative;display:inline-block">${esc(w)}</span>` : esc(w))).join(" ");
    document.getElementById("note-back").innerHTML = `<div class="mono" style="font:700 30px/1 'Geist Mono';letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-2)">${esc(S.idea.teaser || "the one idea")}</div><div class="serif" style="font-size:${ss}px;line-height:1.04;letter-spacing:-0.02em;margin-top:26px;width:1100px">${html}</div>`;
    const corner = { x: 752, y: -448, scale: 0.15, rotation: 4 };
    const tPlant = win[0].tOut - 0.8;
    tl.fromTo(note, { x: -540, y: 270, scale: 0.1, rotation: -12, opacity: 0 }, { x: -540, y: 270, scale: 0.3, rotation: -4, opacity: 1, duration: 0.55, ease: "back.out(1.6)" }, tPlant);
    tl.to(note, { ...corner, duration: 0.8, ease: "power3.inOut" }, tPlant + 0.8);
    sfx("paper", tPlant, -11);
    const w = win[ideaAt];
    const tF = w.tIn + 0.1;
    tl.to(note, { x: 0, y: -20, scale: 1, rotation: 0, duration: 0.75, ease: "power3.inOut" }, tF);
    tl.fromTo("#note-inner", { rotationY: 0 }, { rotationY: 180, duration: 0.7, ease: "power2.inOut" }, tF + 0.6);
    tl.set("#note-back", { visibility: "visible" }, tF + 0.95);
    tl.set("#note-front", { visibility: "hidden" }, tF + 0.95);
    sfx("swell", tF - 1.8, -14);
    sfx("whoosh", tF, -9);
    sfx("paper", tF + 0.65, -11);
    const em = document.getElementById("emph");
    if (em) {
      const u = document.createElementNS(NS, "svg");
      u.setAttribute("width", "100%");
      u.setAttribute("height", "30");
      u.setAttribute("viewBox", "0 0 250 30");
      u.setAttribute("preserveAspectRatio", "none");
      u.style.cssText = `position:absolute;left:-4px;bottom:${-Math.round(ss * 0.16)}px;width:calc(100% + 8px)`;
      u.innerHTML = `<path pathLength="1" d="M4 18 C 60 6, 150 26, 246 10" fill="none" stroke="#7a2be0" stroke-width="7" stroke-linecap="round" style="stroke-dasharray:1;stroke-dashoffset:1"/>`;
      em.appendChild(u);
      const tU = Math.max(tF + 1.35, wordTime(ideaAt, emph) ?? 0);
      tl.fromTo(u.firstChild, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" }, tU);
      sfx("tick", tU, -10);
    }
    tl.to(note, { ...corner, duration: 0.75, ease: "power3.inOut" }, w.tOut - 0.45);
    sfx("whoosh", w.tOut - 0.45, -12);
    tl.to(note, { opacity: 0, scale: 0.08, duration: 0.4, ease: "power2.in" }, win[last].tIn);
  } else {
    note.style.display = "none";
  }

  tl.to({}, { duration: 0.01 }, DUR - 0.01);
  window.__timelines["main"] = tl;
}
document.fonts.ready.then(build);
