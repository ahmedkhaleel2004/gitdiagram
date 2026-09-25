// Shot engine: draws a free-form shot plan (window.SPEC, version 2) on the
// narration clock (window.TIMING). Every element and action lands on the word
// that cued it. Model-written text only ever reaches the DOM escaped.
function build() {
  var S = window.SPEC;
  var M = window.META;
  var T = window.TIMING;
  var DUR = T.DURATION;
  var TB = T.beats;
  var U = 120;
  var NS = "http://www.w3.org/2000/svg";
  var INK = "#17111f";
  var tl = gsap.timeline({ paused: true });
  var stage = document.getElementById("scenes");

  // Model-written ids and names index tables, and "constructor" is a fine id:
  // no lookup may reach a prototype.
  function dict() {
    return Object.create(null);
  }
  function own(table, key) {
    return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
  }

  // ---------- sound ----------
  // Builders ask for hits freely; mixSfx (run once the film is built) keeps a
  // sparse, varied few: short untuned foley only, the scene change plus at most
  // three hits a scene, never the same sound twice within three seconds, and
  // every repeat slightly re-pitched so nothing sounds copy-pasted.
  var SFX = (window.__SFX = []);
  var sfxWanted = [];
  var sfxScene = 0;
  var SFX_RANK = { whoosh: 3, stamp: 2, pop: 1, tick: 0 };
  function sfx(name, t, gain, rate, transition) {
    sfxWanted.push({ name: name, t: Math.max(0, t), gain: gain || 0, rate: rate || 1, scene: sfxScene, transition: Boolean(transition) });
  }
  function mixSfx() {
    var PER_SCENE = 3;
    var perScene = {};
    var picked = [];
    sfxWanted
      .slice()
      .sort(function (a, b) {
        return b.transition - a.transition || SFX_RANK[b.name] - SFX_RANK[a.name] || a.t - b.t;
      })
      .forEach(function (c) {
        if (!c.transition && (perScene[c.scene] || 0) >= PER_SCENE) return;
        for (var i = 0; i < picked.length; i++) {
          var gap = Math.abs(picked[i].t - c.t);
          if (gap < 0.7 || (picked[i].name === c.name && gap < 3)) return;
        }
        if (!c.transition) perScene[c.scene] = (perScene[c.scene] || 0) + 1;
        picked.push(c);
      });
    var RATE = [1, 0.93, 1.07, 0.96, 1.11, 0.9];
    var GAIN = [0, -1.5, -0.5, -2.5, -1];
    var seen = {};
    picked
      .sort(function (a, b) { return a.t - b.t; })
      .forEach(function (c) {
        var k = (seen[c.name] = (seen[c.name] || 0) + 1) - 1;
        SFX.push({ name: c.name, t: Number(c.t.toFixed(3)), gain: c.gain + GAIN[k % GAIN.length], rate: Number((c.rate * RATE[k % RATE.length]).toFixed(3)) });
      });
  }

  // ---------- DOM + text ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function h(tag, cls, style, parent, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (style) e.style.cssText = style;
    if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }
  var ctx2d = document.createElement("canvas").getContext("2d");
  function textW(text, font) {
    ctx2d.font = font;
    return ctx2d.measureText(text).width;
  }
  function wrap(text, font, maxW) {
    var out = [];
    var line = "";
    String(text)
      .split(/\s+/)
      .forEach(function (w) {
        var next = line ? line + " " + w : w;
        if (line && textW(next, font) > maxW) {
          out.push(line);
          line = w;
        } else line = next;
      });
    if (line) out.push(line);
    return out;
  }
  // Largest size at which the text wraps inside the box.
  function fitSize(text, fontOf, maxW, maxH, lineHeight, max, min) {
    var longest = String(text)
      .split(/\s+/)
      .sort(function (a, b) {
        return b.length - a.length;
      })[0] || "";
    for (var s = max; s > min; s -= 1) {
      var font = fontOf(s);
      if (textW(longest, font) > maxW) continue;
      if (wrap(text, font, maxW).length * s * lineHeight <= maxH) return s;
    }
    return min;
  }
  // The canvas estimates above miss italics, kerning and flex padding, so every
  // text block is checked against its real layout: shrink until the content
  // fits its width (and height, when given), then ellipsize what still spills.
  function fitText(node, maxH, min) {
    var size = parseFloat(getComputedStyle(node).fontSize);
    function fits() {
      return node.scrollWidth <= node.clientWidth + 1 && (maxH == null || node.scrollHeight <= maxH + 1);
    }
    while (!fits() && size > min) {
      size -= 1;
      node.style.fontSize = size + "px";
    }
    if (!fits()) {
      node.style.overflow = "hidden";
      node.style.textOverflow = "ellipsis";
    }
    return size;
  }
  function monoFit(lines, maxW, maxH, max, min, lineHeight) {
    var longest = Math.max.apply(null, lines.map(function (l) { return l.length; }).concat([8]));
    var byW = maxW / (longest * 0.6);
    var byH = maxH / (Math.max(1, lines.length) * lineHeight);
    return Math.max(min, Math.min(max, Math.floor(Math.min(byW, byH))));
  }
  function accentHtml(text) {
    return esc(text).replace(/\*([^*]+)\*/g, '<span class="it" style="color:var(--purple-deep)">$1</span>');
  }
  // Split display text into words, carrying *accent* spans that cross word boundaries.
  function accentWords(text) {
    var on = false;
    return String(text)
      .split(/\s+/)
      .filter(Boolean)
      .map(function (word) {
        var starts = word.charAt(0) === "*";
        var clean = word.replace(/\*/g, "");
        if (starts) on = true;
        var html = on ? '<span class="it" style="color:var(--purple-deep)">' + esc(clean) + "</span>" : esc(clean);
        if (word.length > 1 && word.charAt(word.length - 1) === "*") on = false;
        else if (!starts && word.indexOf("*") > 0) on = !on;
        return html;
      });
  }

  // ---------- syntax tint ----------
  var KW = dict();
  "const let var function return if else for while do switch case break continue new class extends implements import export from default async await yield try catch finally throw typeof instanceof in of this super null undefined true false def lambda pass raise with as elif not and or is None True False self func package type struct interface map chan go defer select range fn pub impl trait enum mod use match mut ref where crate static public private protected void int string bool readonly abstract override val fun object when"
    .split(" ")
    .forEach(function (k) {
      KW[k] = 1;
    });
  function tint(line, hashComments) {
    var re = hashComments
      ? /(#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g
      : /(\/\/.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;
    var out = "";
    var last = 0;
    var m;
    while ((m = re.exec(line))) {
      out += esc(line.slice(last, m.index));
      if (m[1]) out += '<span class="tk-c">' + esc(m[1]) + "</span>";
      else if (m[2]) out += '<span class="tk-s">' + esc(m[2]) + "</span>";
      else if (m[3]) out += '<span class="tk-n">' + esc(m[3]) + "</span>";
      else out += KW[m[4]] ? '<span class="tk-k">' + esc(m[4]) + "</span>" : esc(m[4]);
      last = m.index + m[0].length;
    }
    return out + esc(line.slice(last));
  }

  // ---------- icons (24×24 line art) ----------
  var ICON = {
    server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    database: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    file: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>',
    folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2.5h7.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    queue: '<rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="16" width="18" height="4" rx="1"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    cloud: '<path d="M7 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.5 1.5A4 4 0 0 1 17.5 18z"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
    gear: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    package: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
    browser: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M6.5 6.5h.01M9 6.5h.01"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    cache: '<path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v10c0 1.7 3.6 3 8 3M20 7v4"/><path d="M15 16l2 2 4-4"/>',
  };
  function icon(name, size) {
    if (!own(ICON, name)) return "";
    return (
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="#17111f" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">' +
      ICON[name] +
      "</svg>"
    );
  }
  var CHECK = '<svg width="24" height="24" viewBox="0 0 22 22" fill="none" stroke="#0f7a48" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11 L9 16 L18 6"/></svg>';
  var CROSS = '<svg width="24" height="24" viewBox="0 0 22 22" fill="none" stroke="#b3263a" stroke-width="4" stroke-linecap="round"><path d="M5 5 L17 17 M17 5 L5 17"/></svg>';
  // The GitDiagram mark (the favicon: a document holding a small flowchart).
  var GLYPH = '<svg width="34" height="34" viewBox="94 94 832 832" aria-hidden="true"><g transform="translate(0.000000,1024.000000) scale(0.100000,-0.100000)" fill="#9333ea"><path d="M3860 9210 l-1215 -5 -70 -27 c-205 -78 -355 -207 -439 -378 -15 -30 -31 -62 -36 -71 -5 -9 -18 -56 -29 -104 l-21 -87 0 -3418 0 -3418 21 -87 c11 -48 24 -95 29 -104 5 -9 21 -41 36 -71 85 -173 241 -306 444 -378 l75 -27 2465 0 2465 0 75 27 c203 72 359 205 444 378 15 30 31 62 36 71 5 9 18 56 29 104 21 86 21 98 21 2300 0 1445 -3 2216 -10 2220 -5 3 -504 6 -1107 5 -1178 0 -1313 4 -1429 44 -239 84 -407 258 -496 516 l-22 65 -6 1219 c-5 1208 -5 1219 -25 1225 -11 3 -567 4 -1235 1z m518 -2560 c121 -16 202 -90 223 -205 6 -34 9 -263 7 -597 -3 -497 -4 -546 -21 -575 -31 -57 -80 -105 -132 -129 -45 -21 -65 -24 -190 -24 -77 0 -146 -4 -153 -9 -11 -7 -14 -93 -13 -452 0 -244 1 -448 1 -453 0 -19 585 -598 615 -610 22 -8 154 -10 470 -6 l440 5 5 155 c5 142 7 159 31 205 27 52 101 118 148 130 44 13 1023 18 1116 6 63 -8 94 -17 125 -37 56 -37 98 -102 111 -169 6 -34 9 -258 7 -597 -3 -497 -4 -546 -21 -575 -31 -57 -80 -105 -132 -129 l-50 -24 -565 0 -565 0 -50 24 c-28 12 -65 39 -82 60 -61 69 -66 87 -72 261 l-6 160 -455 3 -454 2 -361 -359 c-396 -396 -402 -401 -515 -401 -114 0 -115 2 -553 438 -219 218 -409 413 -423 433 -52 75 -60 159 -24 255 6 16 175 194 376 395 200 201 364 369 364 375 0 5 1 209 1 453 1 359 -2 445 -13 452 -7 5 -76 9 -153 9 -125 0 -145 3 -190 24 -52 24 -101 72 -132 129 -17 29 -18 78 -21 581 -2 354 1 567 7 598 24 108 105 183 214 197 88 12 997 12 1085 1z M5635 9038 c-3 -13 -4 -511 -3 -1108 l3 -1085 22 -41 c31 -58 90 -111 143 -129 39 -13 198 -15 1135 -16 1011 0 1090 1 1093 16 3 11 -391 412 -1181 1201 -651 651 -1189 1184 -1195 1184 -7 0 -14 -10 -17 -22z"/></g></svg>';
  var TONE_BG = { plain: "var(--card)", accent: "var(--purple)", soft: "var(--purple-soft)", ok: "var(--green-soft)", bad: "var(--red-soft)", ghost: "transparent" };
  var TONE_INK = { plain: INK, accent: INK, soft: INK, ok: "#0f7a48", bad: "#b3263a", ghost: INK };
  var PAINT = { none: "none", paper: "#f2e8ff", card: "#fdfaff", accent: "#bd85fb", soft: "#dcc2ff", ink: INK, ok: "#cff2de", bad: "#ffd9da" };
  function toneOf(name) {
    return own(TONE_BG, name) ? name : "plain";
  }

  // ---------- clock ----------
  // The server's normalizeWord (src/server/explainer/text.ts).
  function norm(w) {
    return String(w || "").toLowerCase().replace(/[^a-z0-9.#/]/g, "").replace(/^\.{2,}|\.+$/g, "");
  }
  // An exact word first, so a cue for "data" never lands on an earlier
  // "database"; a shared stem ("route" for "routes") only as a fallback.
  function cueTime(bi, word) {
    var c = norm(word);
    if (!c) return null;
    var ws = TB[bi].words;
    var k;
    for (k = 0; k < ws.length; k++) if (ws[k].w === c) return ws[k].s;
    for (k = 0; k < ws.length; k++) {
      var w = ws[k].w;
      if ((c.length > 3 && w.indexOf(c) === 0) || (w.length > 3 && c.indexOf(w) === 0)) return ws[k].s;
    }
    return null;
  }

  // ---------- scenes ----------
  var beats = S.beats;
  var scenes = [];
  beats.forEach(function (b, i) {
    var last = scenes[scenes.length - 1];
    if (last && last.id === b.scene) last.beats.push(i);
    else scenes.push({ id: b.scene, beats: [i], transition: b.transition });
  });
  var CYCLE = ["slide", "push", "zoom", "slide", "cut", "push", "zoom"];
  var endAt = Math.min(DUR - 2.4, T.SPEECH_END + 0.5);
  scenes.forEach(function (sc, k) {
    var first = sc.beats[0];
    sc.tIn = k === 0 ? 0 : TB[first].start - 0.22;
    sc.tOut = k === scenes.length - 1 ? endAt : TB[scenes[k + 1].beats[0]].start - 0.22;
    sc.transition = sc.transition || CYCLE[k % CYCLE.length];
  });

  function transitionIn(el, kind, t) {
    if (kind === "slide") tl.fromTo(el, { x: 180, opacity: 0 }, { x: 0, opacity: 1, duration: 0.42, ease: "power3.out" }, t);
    else if (kind === "push") tl.fromTo(el, { y: 140, opacity: 0 }, { y: 0, opacity: 1, duration: 0.42, ease: "power3.out" }, t);
    else if (kind === "zoom") tl.fromTo(el, { scale: 0.9, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: "power3.out" }, t);
    else tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.06 }, t);
  }
  function transitionOut(el, kind, t) {
    if (kind === "slide") tl.to(el, { x: -180, opacity: 0, duration: 0.3, ease: "power2.in" }, t - 0.3);
    else if (kind === "push") tl.to(el, { y: -140, opacity: 0, duration: 0.3, ease: "power2.in" }, t - 0.3);
    else if (kind === "zoom") tl.to(el, { scale: 1.12, opacity: 0, duration: 0.32, ease: "power2.in" }, t - 0.32);
    else tl.to(el, { opacity: 0, duration: 0.05 }, t - 0.05);
  }

  // ---------- element builders ----------
  // Each returns { el, enter(t) } plus whatever later actions need (a label to
  // replace, line bars, typed lines). A visual made of sibling nodes (an
  // arrow) lists them all in `nodes`, so every action reaches every part.
  function place(parent, e, extra) {
    var el = h(
      "div",
      "shot",
      "position:absolute;left:" + e.x * U + "px;top:" + e.y * U + "px;width:" + e.w * U + "px;height:" + e.h * U + "px;" + (extra || ""),
      parent,
    );
    el.dataset.id = e.id;
    el.dataset.kind = e.kind;
    return el;
  }
  function cardStyle(bg) {
    return "background:" + (bg || "var(--card)") + ";border:3px solid " + INK + ";border-radius:16px;box-shadow:7px 7px 0 " + INK + ";overflow:hidden;";
  }
  function popIn(el, t, o) {
    o = o || {};
    tl.fromTo(el, { opacity: 0, scale: o.from || 0.7 }, { opacity: 1, scale: 1, duration: o.d || 0.36, ease: o.ease || "back.out(1.9)" }, t);
  }
  function riseIn(el, t, o) {
    o = o || {};
    tl.fromTo(el, { opacity: 0, y: o.y == null ? 30 : o.y, x: o.x || 0 }, { opacity: 1, y: 0, x: 0, duration: o.d || 0.42, ease: "power3.out" }, t);
  }
  function typeIn(el, t, d) {
    var n = Math.max(1, (el.textContent || "").length);
    tl.fromTo(el, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: d, ease: "steps(" + n + ")" }, t);
    tl.set(el, { clipPath: "none" }, t + d + 0.01);
  }

  var B = dict();
  B.heading = function (e, layer) {
    var W = e.w * U;
    var H = e.h * U;
    var size = fitSize(e.text.replace(/\*/g, ""), function (s) { return "400 " + s + 'px "Instrument Serif"'; }, W, H, 1.02, 150, 28);
    var el = place(layer, e, "display:flex;align-items:center;");
    var inner = h("div", "serif", "width:100%;font-size:" + size + "px;line-height:1.02;letter-spacing:-0.02em", el);
    var spans = [];
    accentWords(e.text).forEach(function (w) {
      var sp = h("span", "hw", "", inner, w);
      inner.appendChild(document.createTextNode(" "));
      spans.push(sp);
    });
    fitText(inner, H, 24);
    return {
      el: el,
      label: inner,
      labelHost: el,
      enter: function (t) {
        spans.forEach(function (sp, k) {
          tl.fromTo(sp, { opacity: 0, y: 34 }, { opacity: 1, y: 0, duration: 0.42, ease: "power3.out" }, t + k * 0.045);
        });
      },
    };
  };
  B.text = function (e, layer) {
    var W = e.w * U;
    var H = e.h * U;
    var fam = e.mono ? '"Geist Mono"' : "Geist";
    var weight = e.mono ? 500 : 520;
    var max = { s: 26, m: 36, l: 50 }[e.size] || 36;
    var size = fitSize(e.text, function (s) { return weight + " " + s + "px " + fam; }, W, H, 1.28, max, 16);
    var color = e.tone === "muted" ? "var(--ink-2)" : e.tone === "accent" ? "var(--purple-deep)" : INK;
    var el = place(layer, e, "display:flex;align-items:center;");
    var inner = h("div", "", "width:100%;font:" + weight + " " + size + "px/1.28 " + fam + ";color:" + color, el, esc(e.text));
    fitText(inner, H, 14);
    return { el: el, label: inner, labelHost: el, enter: function (t) { riseIn(el, t, { y: 18, d: 0.36 }); } };
  };
  B.code = function (e, layer, future) {
    var el = place(layer, e, cardStyle());
    h("div", "panel-head", "height:52px;font-size:18px;letter-spacing:0.02em", el, esc(e.title || ""));
    var extra = future.filter(function (a) { return a.do === "type"; }).map(function (a) { return a.line || ""; });
    var all = e.lines.concat(extra);
    var lh = 1.62;
    var fs = monoFit(all, e.w * U - 96, e.h * U - 52 - 26, 34, 17, lh);
    var maxChars = Math.floor((e.w * U - 96) / (fs * 0.6));
    all = all.map(function (l) { return l.length > maxChars ? l.slice(0, maxChars - 1) + "…" : l; });
    e = Object.assign({}, e, { lines: all.slice(0, e.lines.length) });
    extra = all.slice(e.lines.length);
    var hash = /\.(py|rb|sh|ex|exs|r|jl|pl|toml|ya?ml)$/i.test(e.title || "");
    var body = h("div", "", "position:absolute;left:0;right:0;top:52px;bottom:0;padding:13px 0", el);
    var bars = {};
    var lineEls = [];
    function line(text, i) {
      var y = 13 + i * fs * lh;
      h("div", "mono", "position:absolute;left:14px;top:" + y + "px;width:40px;text-align:right;font:400 " + (fs - 3) + "px/" + fs * lh + "px 'Geist Mono';color:rgba(78,68,99,0.6)", body, String(i + 1));
      return h("div", "code", "position:absolute;left:68px;top:" + y + "px;font-size:" + fs + "px;line-height:" + fs * lh + "px;white-space:pre;width:max-content", body, text.trim() === "…" ? '<span class="tk-c">…</span>' : tint(text, hash));
    }
    function bar(n) {
      if (n < 1 || n > all.length) return null;
      if (!bars[n]) bars[n] = h("div", "hl", "left:6px;right:6px;top:" + (13 + (n - 1) * fs * lh) + "px;height:" + fs * lh + "px;width:auto", body);
      if (body.firstChild !== bars[n]) body.insertBefore(bars[n], body.firstChild);
      return bars[n];
    }
    e.lines.forEach(function (l, i) { lineEls.push(line(l, i)); });
    var pending = extra.map(function (l, i) { var n = line(l, e.lines.length + i); n.style.opacity = 0; return n; });
    return {
      el: el,
      bar: bar,
      pending: pending,
      enter: function (t) {
        riseIn(el, t, { y: 26 });
        lineEls.forEach(function (n, i) { typeIn(n, t + 0.18 + i * 0.05, Math.min(0.26, 0.04 + (n.textContent || "").length * 0.006)); });
        (e.focus || []).forEach(function (n) { var b = bar(n); if (b) tl.fromTo(b, { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power3.out" }, t + 0.5); });
        sfx("pop", t + 0.05, -17, 0.8);
      },
    };
  };
  B.terminal = function (e, layer, future) {
    var el = place(layer, e, "background:#17111f;border:3px solid " + INK + ";border-radius:14px;box-shadow:7px 7px 0 #7a2be0;overflow:hidden;");
    var head = h("div", "", "height:44px;display:flex;align-items:center;gap:9px;padding:0 16px;border-bottom:2px solid #3a2f4a;font:500 16px/1 'Geist Mono';color:#b9a8d6", el);
    head.innerHTML = '<i style="width:12px;height:12px;border-radius:50%;background:#ff6b6b;display:block"></i><i style="width:12px;height:12px;border-radius:50%;background:#ffd166;display:block"></i><i style="width:12px;height:12px;border-radius:50%;background:#7ee2a8;display:block"></i><span style="margin-left:8px">' + esc(e.title || "terminal") + "</span>";
    var extra = future.filter(function (a) { return a.do === "type"; }).map(function (a) { return a.line || ""; });
    var all = e.lines.concat(extra);
    var fs = monoFit(all, e.w * U - 48, e.h * U - 44 - 24, 32, 17, 1.55);
    var cut = Math.floor((e.w * U - 48) / (fs * 0.6));
    all = all.map(function (l) { return l.length > cut ? l.slice(0, cut - 1) + "…" : l; });
    e = Object.assign({}, e, { lines: all.slice(0, e.lines.length) });
    extra = all.slice(e.lines.length);
    var body = h("div", "", "position:absolute;left:22px;right:16px;top:56px", el);
    function line(text) {
      var cmd = /^\$ /.test(text);
      return h("div", "", "font:500 " + fs + "px/" + fs * 1.55 + "px 'Geist Mono';white-space:pre;width:max-content;color:" + (cmd ? "#f2e8ff" : "#b9a8d6"), body, cmd ? '<span style="color:#7ee2a8">$</span> ' + esc(text.slice(2)) : esc(text));
    }
    var lines = e.lines.map(line);
    var pending = extra.map(function (l) { var n = line(l); n.style.opacity = 0; return n; });
    return {
      el: el,
      dark: true,
      pending: pending,
      enter: function (t) {
        riseIn(el, t, { y: 26 });
        var at = t + 0.2;
        lines.forEach(function (n) {
          if (/^\$ /.test(n.textContent || "") || n.textContent.charAt(0) === "$") {
            typeIn(n, at, Math.min(0.7, 0.05 + n.textContent.length * 0.018));
            at += Math.min(0.75, 0.1 + n.textContent.length * 0.018);
          } else {
            tl.fromTo(n, { opacity: 0 }, { opacity: 1, duration: 0.08 }, at);
            at += 0.06;
          }
        });
        sfx("pop", t + 0.05, -17, 0.8);
      },
    };
  };
  B.box = function (e, layer) {
    var W = e.w * U;
    var H = e.h * U;
    var tn = toneOf(e.tone);
    var ghost = tn === "ghost";
    var el = place(layer, e, cardStyle(TONE_BG[tn]) + (ghost ? "border-style:dashed;box-shadow:none;" : "") + "display:flex;align-items:center;gap:14px;padding:0 20px;");
    var ic = e.icon && e.icon !== "none" ? Math.min(46, H * 0.42) : 0;
    if (ic) el.insertAdjacentHTML("beforeend", icon(e.icon, ic));
    var col = h("div", "", "position:relative;flex:1;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:center", el);
    var tw = W - 44 - (ic ? ic + 14 : 0);
    var ls = fitSize(e.label, function (s) { return "650 " + s + "px Geist"; }, tw, (e.sub ? H * 0.5 : H * 0.72), 1.12, 40, 16);
    var label = h("div", "", "font:650 " + ls + "px/1.12 Geist;color:" + TONE_INK[tn] + ";letter-spacing:-0.01em", col, esc(e.label));
    var sub = null;
    if (e.sub) {
      var ss = Math.max(14, Math.min(22, Math.floor(tw / (e.sub.length * 0.6)), Math.floor(H * 0.22)));
      sub = h("div", "mono", "margin-top:6px;font:500 " + ss + "px/1.2 'Geist Mono';color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis", col, esc(e.sub));
    }
    fitText(label, H - (sub ? sub.offsetHeight + 6 : 0) - 8, 13);
    return { el: el, label: label, labelHost: col, enter: function (t) { popIn(el, t); sfx("pop", t, -15); } };
  };
  B.chip = function (e, layer) {
    var H = e.h * U;
    var tn = toneOf(e.tone);
    var fs = Math.max(15, Math.min(Math.floor(H * 0.42), Math.floor((e.w * U - 36) / (e.text.length * 0.6))));
    var el = place(layer, e, "display:flex;align-items:center;justify-content:center;border:3px solid " + INK + ";border-radius:999px;background:" + TONE_BG[tn] + ";box-shadow:3px 3px 0 " + INK + ";padding:0 18px;font:600 " + fs + "px/1 'Geist Mono';color:" + TONE_INK[tn] + ";white-space:nowrap;overflow:hidden");
    var label = h("span", "", "display:block;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis", el, esc(e.text));
    fitText(label, null, 12);
    return { el: el, label: label, labelHost: el, enter: function (t) { popIn(el, t, { from: 0.5 }); } };
  };
  B.file = function (e, layer) {
    var H = e.h * U;
    var parts = String(e.path).split("/");
    var name = parts.pop();
    var dir = parts.join("/");
    var el = place(layer, e, cardStyle() + "display:flex;align-items:center;gap:14px;padding:0 18px;");
    el.insertAdjacentHTML("beforeend", icon("file", Math.min(40, H * 0.5)));
    var col = h("div", "", "flex:1;min-width:0", el);
    var ns = Math.max(16, Math.min(Math.floor(H * 0.34), Math.floor((e.w * U - 90) / (name.length * 0.6)), 30));
    fitText(h("div", "mono", "font:650 " + ns + "px/1.15 'Geist Mono';white-space:nowrap", col, esc(name)), null, 13);
    if (dir) h("div", "mono", "margin-top:4px;font:500 " + Math.max(13, ns - 8) + "px/1.2 'Geist Mono';color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis", col, esc(dir + "/"));
    return { el: el, enter: function (t) { riseIn(el, t, { x: -40, y: 0, d: 0.36 }); sfx("pop", t, -17, 0.9); } };
  };
  B.tree = function (e, layer) {
    var el = place(layer, e, cardStyle());
    h("div", "panel-head", "height:48px;font-size:17px", el, esc(M.owner + "/" + M.repo));
    var n = Math.max(1, e.paths.length);
    var fs = monoFit(e.paths, e.w * U - 60, e.h * U - 48 - 20, 23, 13, 1.7);
    var rh = fs * 1.7;
    var body = h("div", "", "position:absolute;left:0;right:0;top:" + (48 + Math.max(10, (e.h * U - 48 - rh * n) / 2)) + "px", el);
    var rows = [];
    var bars = {};
    e.paths.forEach(function (p) {
      rows.push(h("div", "mono", "position:relative;height:" + rh + "px;padding-left:28px;font:500 " + fs + "px/" + rh + "px 'Geist Mono';white-space:nowrap", body, esc(p)));
    });
    function bar(i) {
      if (i < 1 || i > rows.length) return null;
      if (!bars[i]) {
        bars[i] = h("div", "hl", "left:10px;right:10px;top:" + (i - 1) * rh + "px;height:" + rh + "px;width:auto", body);
        body.insertBefore(bars[i], body.firstChild);
      }
      return bars[i];
    }
    return {
      el: el,
      rowBar: bar,
      enter: function (t) {
        riseIn(el, t, { y: 26 });
        rows.forEach(function (r, i) { riseIn(r, t + 0.15 + i * 0.04, { x: -14, y: 0, d: 0.26 }); });
        (e.focus || []).forEach(function (i) { var b = bar(i); if (b) tl.fromTo(b, { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power3.out" }, t + 0.5); });
        sfx("pop", t + 0.05, -17, 0.8);
      },
    };
  };
  B.table = function (e, layer) {
    var el = place(layer, e, cardStyle());
    var cols = Math.max(e.columns.length, Math.max.apply(null, e.rows.map(function (r) { return r.length; }).concat([1])));
    var widths = [];
    for (var c = 0; c < cols; c++) {
      var longest = (e.columns[c] || "").length;
      e.rows.forEach(function (r) { longest = Math.max(longest, (r[c] || "").length); });
      widths.push(Math.max(4, longest));
    }
    var total = widths.reduce(function (a, b) { return a + b; }, 0);
    var n = e.rows.length + 1;
    var rh = Math.min(64, (e.h * U - 16) / n);
    var fs = Math.max(13, Math.min(Math.floor(rh * 0.42), Math.floor((e.w * U - 40 - cols * 20) / (total * 0.6))));
    var rows = [];
    var bars = {};
    function row(cells, i, header) {
      var r = h("div", "", "position:absolute;left:0;right:0;top:" + (8 + i * rh) + "px;height:" + rh + "px;display:flex;align-items:center;padding:0 20px;" + (header ? "border-bottom:3px solid " + INK + ";" : ""), el);
      for (var c = 0; c < cols; c++)
        h("div", "mono", "flex:" + widths[c] + ";min-width:0;padding-right:20px;font:" + (header ? 650 : 500) + " " + fs + "px/1 'Geist Mono';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:" + (header ? "var(--ink-2)" : INK) + (header ? ";text-transform:uppercase;letter-spacing:0.06em" : ""), r, esc(cells[c] || ""));
      return r;
    }
    if (e.columns.length) row(e.columns, 0, true);
    e.rows.forEach(function (cells, i) { rows.push(row(cells, i + (e.columns.length ? 1 : 0))); });
    function bar(i) {
      if (!bars[i]) {
        var r = rows[i - 1];
        if (!r) return null;
        bars[i] = h("div", "hl", "left:8px;right:8px;top:" + r.style.top + ";height:" + rh + "px;width:auto", el);
        el.insertBefore(bars[i], el.firstChild);
      }
      return bars[i];
    }
    return {
      el: el,
      rowBar: bar,
      enter: function (t) {
        riseIn(el, t, { y: 26 });
        rows.forEach(function (r, i) { riseIn(r, t + 0.2 + i * 0.07, { x: -12, y: 0, d: 0.28 }); });
        sfx("pop", t + 0.05, -17, 0.8);
      },
    };
  };
  B.bars = function (e, layer) {
    var el = place(layer, e, "");
    var n = Math.max(1, e.items.length);
    var rh = (e.h * U) / n;
    var max = Math.max.apply(null, e.items.map(function (it) { return Math.abs(it.value); }).concat([1e-9]));
    var labelW = Math.min(e.w * U * 0.36, 12 + 13 * Math.max.apply(null, e.items.map(function (it) { return it.label.length; }).concat([4])));
    var fs = Math.max(15, Math.min(26, Math.floor(rh * 0.36)));
    var trackW = e.w * U - labelW - 14;
    var valueW = Math.max.apply(null, e.items.map(function (it) { return textW(fmt(it.value) + (e.unit ? " " + e.unit : ""), "650 " + fs + "px 'Geist Mono'"); }).concat([0]));
    var reach = Math.max(30, Math.min(82, (100 * (trackW - valueW - 20)) / trackW));
    var fills = [];
    e.items.forEach(function (it, i) {
      var r = h("div", "", "position:absolute;left:0;right:0;top:" + i * rh + "px;height:" + rh + "px;display:flex;align-items:center;gap:14px", el);
      h("div", "", "width:" + labelW + "px;flex-shrink:0;text-align:right;font:600 " + fs + "px/1.1 Geist;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", r, esc(it.label));
      var track = h("div", "", "position:relative;flex:1;height:" + Math.min(46, rh * 0.62) + "px", r);
      var width = Math.max(0.04, Math.abs(it.value) / max);
      var fill = h("div", "", "position:absolute;left:0;top:0;bottom:0;width:" + width * reach + "%;border:3px solid " + INK + ";border-radius:8px;background:" + (i === 0 ? "var(--purple)" : "var(--purple-soft)") + ";box-shadow:3px 3px 0 " + INK + ";transform-origin:left center", track);
      h("div", "mono", "position:absolute;left:calc(" + width * reach + "% + 12px);top:50%;transform:translateY(-50%);font:650 " + fs + "px/1 'Geist Mono';white-space:nowrap", track, esc(fmt(it.value) + (e.unit ? " " + e.unit : "")));
      fills.push(fill);
    });
    return {
      el: el,
      enter: function (t) {
        tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.2 }, t);
        fills.forEach(function (f, i) { tl.fromTo(f, { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: "power3.out" }, t + 0.1 + i * 0.08); });
      },
    };
  };
  function fmt(v) {
    return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  function odometer(parent, value, prefix, suffix, size) {
    var row = h("div", "serif", "display:flex;align-items:flex-end;font-size:" + size + "px;line-height:1;height:" + size + "px;letter-spacing:-0.02em", parent);
    if (prefix) h("span", "", "", row, esc(prefix));
    var strips = [];
    var str = fmt(value);
    str.split("").forEach(function (ch) {
      if (!/\d/.test(ch)) {
        h("span", "", "display:inline-block;height:" + size + "px", row, esc(ch));
        return;
      }
      var col = h("span", "digit", "height:" + size + "px;line-height:" + size + "px", row);
      var cells = "";
      for (var d = 0; d < 20; d++) cells += '<span style="height:' + size + 'px;display:block">' + (d % 10) + "</span>";
      strips.push({ el: h("span", "strip", "", col, cells), digit: Number(ch) });
    });
    if (suffix) h("span", "it", "font-size:" + Math.round(size * 0.52) + "px;margin-left:10px;margin-bottom:" + Math.round(size * 0.08) + "px;color:var(--purple-deep)", row, esc(suffix));
    return { row: row, roll: function (t) { strips.forEach(function (s, i) { tl.fromTo(s.el, { y: 0 }, { y: -(10 + s.digit) * size, duration: 0.9, ease: "power3.out" }, t + (strips.length - i) * 0.04); }); } };
  }
  B.number = function (e, layer, future) {
    var W = e.w * U;
    var H = e.h * U;
    var el = place(layer, e, "display:flex;flex-direction:column;justify-content:center");
    var label = e.label ? 1 : 0;
    var text = (e.prefix || "") + fmt(e.value) + (e.suffix || "");
    var size = Math.max(40, Math.min(Math.floor(H * (label ? 0.62 : 0.86)), Math.floor(W / (text.length * 0.52))));
    var host = h("div", "", "position:relative;height:" + size + "px", el);
    var first = odometer(host, e.value, e.prefix, e.suffix, size);
    var later = future.filter(function (a) { return a.do === "count"; }).map(function (a) {
      var wrapEl = h("div", "", "position:absolute;left:0;top:0;opacity:0", host);
      return { od: odometer(wrapEl, Number(a.value) || 0, e.prefix, e.suffix, size), wrap: wrapEl };
    });
    if (label) h("div", "", "margin-top:12px;font:500 " + Math.max(16, Math.min(28, Math.floor(H * 0.16))) + "px/1.2 Geist;color:var(--ink-2)", el, esc(e.label));
    return {
      el: el,
      first: first.row,
      counts: later,
      enter: function (t) { riseIn(el, t, { y: 20, d: 0.3 }); first.roll(t + 0.05); sfx("tick", t + 0.1, -16); },
    };
  };
  B.stamp = function (e, layer) {
    var tone = e.tone === "ok" ? "#0f7a48" : e.tone === "bad" ? "#b3263a" : "#7a2be0";
    var bg = e.tone === "ok" ? "rgba(207,242,222,0.9)" : e.tone === "bad" ? "rgba(255,217,218,0.9)" : "rgba(220,194,255,0.9)";
    var fs = Math.max(20, Math.min(Math.floor(e.h * U * 0.5), Math.floor((e.w * U - 48) / (e.text.length * 0.68))));
    var el = place(layer, e, "display:flex;align-items:center;justify-content:center;padding:0 16px;border:6px solid " + tone + ";border-radius:14px;color:" + tone + ";background:" + bg + ";font:820 " + fs + "px/1 Geist;letter-spacing:0.05em;white-space:nowrap");
    var label = h("span", "", "display:block;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis", el, esc(e.text));
    fitText(label, null, 16);
    return {
      el: el,
      label: label,
      labelHost: el,
      enter: function (t) {
        tl.fromTo(el, { opacity: 0, scale: 1.9, rotation: -14 }, { opacity: 1, scale: 1, rotation: -6, duration: 0.2, ease: "power4.in" }, t);
        sfx("stamp", t + 0.15, -7);
      },
    };
  };
  B.browser = function (e, layer) {
    var el = place(layer, e, cardStyle("var(--paper-2)"));
    var bar = h("div", "", "height:54px;display:flex;align-items:center;gap:14px;padding:0 18px;border-bottom:3px solid " + INK + ";background:var(--card)", el);
    bar.innerHTML = '<div class="dots"><i></i><i></i><i></i></div>';
    var field = h("div", "mono", "position:relative;flex:1;min-width:0;height:34px;border:2px solid " + INK + ";border-radius:999px;overflow:hidden", bar);
    var url = h("div", "", "position:absolute;left:16px;right:16px;top:0;line-height:30px;font:500 18px/30px 'Geist Mono';white-space:nowrap;overflow:hidden;text-overflow:ellipsis", field, esc(e.url || ""));
    return { el: el, label: url, labelHost: field, enter: function (t) { riseIn(el, t, { y: 40 }); sfx("pop", t, -17, 0.8); } };
  };
  B.request = function (e, layer) {
    var W = e.w * U;
    var H = e.h * U;
    var el = place(layer, e, cardStyle());
    var headH = e.lines.length ? Math.min(78, H * 0.45) : H;
    var fs = Math.max(15, Math.min(26, Math.floor(headH * 0.34), Math.floor((W - 260) / (Math.max(8, e.url.length) * 0.6))));
    var head = h("div", "", "height:" + headH + "px;display:flex;align-items:center;gap:14px;padding:0 18px;" + (e.lines.length ? "border-bottom:3px solid " + INK : ""), el);
    h("div", "", "padding:6px 12px;border:2.5px solid " + INK + ";border-radius:8px;background:var(--purple);font:750 " + (fs - 2) + "px/1 'Geist Mono'", head, esc(e.method));
    h("div", "mono", "flex:1;min-width:0;font:600 " + fs + "px/1 'Geist Mono';white-space:nowrap;overflow:hidden;text-overflow:ellipsis", head, esc(e.url));
    var status = null;
    if (e.status != null) {
      var ok = e.status < 400;
      status = h("div", "", "padding:6px 12px;border:2.5px solid " + INK + ";border-radius:999px;background:" + (ok ? "var(--green-soft)" : "var(--red-soft)") + ";color:" + (ok ? "#0f7a48" : "#b3263a") + ";font:750 " + (fs - 2) + "px/1 'Geist Mono'", head, String(e.status));
    }
    var bodyLines = [];
    if (e.lines.length) {
      var bfs = monoFit(e.lines, W - 40, H - headH - 20, 21, 12, 1.5);
      var body = h("div", "", "padding:10px 20px", el);
      e.lines.forEach(function (l) { bodyLines.push(h("div", "mono", "font:500 " + bfs + "px/" + bfs * 1.5 + "px 'Geist Mono';white-space:pre;color:var(--ink-2)", body, esc(l))); });
    }
    return {
      el: el,
      enter: function (t) {
        riseIn(el, t, { x: -60, y: 0, d: 0.38 });
        if (status) popIn(status, t + 0.35, { from: 0.3 });
        bodyLines.forEach(function (b, i) { tl.fromTo(b, { opacity: 0 }, { opacity: 1, duration: 0.15 }, t + 0.3 + i * 0.05); });
        sfx("pop", t, -17, 0.85);
      },
    };
  };
  B.list = function (e, layer) {
    var el = place(layer, e, "display:flex;flex-direction:column;justify-content:center;gap:14px");
    var n = Math.max(1, e.items.length);
    var fs = Math.max(18, Math.min(34, Math.floor((e.h * U - n * 14) / (n * 1.3)), Math.floor((e.w * U - 40) / (Math.max.apply(null, e.items.map(function (i) { return i.length; }).concat([10])) * 0.5))));
    var rows = e.items.map(function (it) {
      return h("div", "", "display:flex;gap:14px;font:500 " + fs + "px/1.25 Geist", el, '<span style="color:var(--purple-deep);font-weight:750">—</span><span>' + esc(it) + "</span>");
    });
    return { el: el, enter: function (t) { rows.forEach(function (r, i) { riseIn(r, t + i * 0.1, { x: -16, y: 0, d: 0.3 }); }); } };
  };
  // A real picture from the repository's README (a logo, a screenshot),
  // stored with the film: plan.images maps its id to a same-origin path.
  B.image = function (e, layer) {
    var src = String(own(S.images || {}, e.src) || "");
    if (!/^\/(?!\/)/.test(src)) return null;
    var el = place(layer, e, cardStyle("var(--card)"));
    var img = h("img", "", "position:absolute;left:12px;right:12px;top:12px;bottom:12px;width:calc(100% - 24px);height:calc(100% - 24px);object-fit:" + (e.fit === "cover" ? "cover" : "contain") + ";border-radius:8px", el);
    img.src = src;
    img.alt = "";
    return {
      el: el,
      enter: function (t) {
        riseIn(el, t, { y: 40, d: 0.5 });
        sfx("pop", t, -17, 0.8);
      },
    };
  };
  B.svg = function (e, layer) {
    var el = place(layer, e, "");
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", e.viewBox);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.overflow = "visible";
    el.appendChild(svg);
    var drawn = [];
    (e.shapes || []).forEach(function (s) {
      var node = document.createElementNS(NS, s.shape);
      ["x", "y", "width", "height", "r", "cx", "cy", "x1", "y1", "x2", "y2", "rx"].forEach(function (k) {
        if (s[k] != null) node.setAttribute(k, s[k]);
      });
      if (s.d) node.setAttribute("d", s.d);
      if (s.points) node.setAttribute("points", s.points);
      node.setAttribute("fill", own(PAINT, s.fill) || "none");
      node.setAttribute("stroke", s.stroke === "none" ? "none" : s.stroke === "accent" ? "#7a2be0" : INK);
      node.setAttribute("stroke-width", "4");
      node.setAttribute("vector-effect", "non-scaling-stroke");
      node.setAttribute("stroke-linecap", "round");
      node.setAttribute("stroke-linejoin", "round");
      svg.appendChild(node);
      drawn.push(node);
    });
    return {
      el: el,
      enter: function (t) {
        drawn.forEach(function (node, i) {
          var at = t + i * 0.05;
          if (/path|line|polyline|polygon/.test(node.tagName) && node.getAttribute("fill") === "none") {
            node.setAttribute("pathLength", "1");
            node.style.strokeDasharray = "1";
            tl.fromTo(node, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.5, ease: "power2.inOut" }, at);
          } else tl.fromTo(node, { opacity: 0 }, { opacity: 1, duration: 0.3 }, at);
        });
      },
    };
  };

  // ---------- arrows ----------
  function rectOf(item) {
    return { x: item.pos.x * U, y: item.pos.y * U, w: item.pos.w * U, h: item.pos.h * U };
  }
  function route(a, b) {
    var ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    var bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    var gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
    var gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
    if (gapX >= gapY) {
      var right = bc.x >= ac.x;
      var x1 = right ? a.x + a.w + 6 : a.x - 6;
      var x2 = right ? b.x - 10 : b.x + b.w + 10;
      var mx = (x1 + x2) / 2;
      return Math.abs(ac.y - bc.y) < 4 ? [[x1, ac.y], [x2, ac.y]] : [[x1, ac.y], [mx, ac.y], [mx, bc.y], [x2, bc.y]];
    }
    var down = bc.y >= ac.y;
    var y1 = down ? a.y + a.h + 6 : a.y - 6;
    var y2 = down ? b.y - 10 : b.y + b.h + 10;
    var my = (y1 + y2) / 2;
    return Math.abs(ac.x - bc.x) < 4 ? [[ac.x, y1], [ac.x, y2]] : [[ac.x, y1], [ac.x, my], [bc.x, my], [bc.x, y2]];
  }
  function buildArrow(e, layer, items) {
    var a = items[e.from];
    var b = items[e.to];
    if (!a || !b) return null;
    var pts = route(rectOf(a), rectOf(b));
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "wires");
    svg.setAttribute("data-id", e.id);
    svg.setAttribute("data-kind", "arrow");
    layer.insertBefore(svg, layer.firstChild);
    var p = document.createElementNS(NS, "path");
    p.setAttribute("d", "M" + pts.map(function (q) { return q[0].toFixed(1) + "," + q[1].toFixed(1); }).join(" L"));
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", INK);
    p.setAttribute("stroke-width", "4");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    p.setAttribute("pathLength", "1");
    p.style.strokeDasharray = e.dashed ? "0.02 0.016" : "1";
    p.style.strokeDashoffset = e.dashed ? "0" : "1";
    if (e.dashed) p.style.opacity = 0;
    svg.appendChild(p);
    var end = pts[pts.length - 1];
    var prev = pts[pts.length - 2];
    var ang = (Math.atan2(end[1] - prev[1], end[0] - prev[0]) * 180) / Math.PI;
    var head = document.createElementNS(NS, "path");
    head.setAttribute("d", "M -14 -9 L 1 0 L -14 9 Z");
    head.setAttribute("fill", INK);
    head.setAttribute("transform", "translate(" + end[0] + "," + end[1] + ") rotate(" + ang + ")");
    head.style.opacity = 0;
    svg.appendChild(head);
    var nodes = [svg];
    var label = null;
    if (e.label) {
      var mid = pts[Math.floor((pts.length - 1) / 2)];
      var nxt = pts[Math.floor((pts.length - 1) / 2) + 1];
      label = h("div", "mono", "position:absolute;left:" + ((mid[0] + nxt[0]) / 2 - 130) + "px;top:" + ((mid[1] + nxt[1]) / 2 - 17) + "px;width:260px;text-align:center;font:600 18px/34px 'Geist Mono';color:var(--ink-2)", layer, '<span style="background:var(--paper);padding:3px 9px;border-radius:6px">' + esc(e.label) + "</span>");
      nodes.push(label);
    }
    // Packets ride in their own box, so an arrow that exits takes a packet
    // still running with it.
    var packets = h("div", "", "position:absolute;left:0;top:0", layer);
    nodes.push(packets);
    var packet = h("div", "", "position:absolute;left:" + (pts[0][0] - 11) + "px;top:" + (pts[0][1] - 11) + "px;width:22px;height:22px;border-radius:50%;background:#7a2be0;border:3px solid " + INK + ";opacity:0", packets);
    // The route's bounds (padded to the label's height), for actions that
    // frame or mark the arrow.
    var xs = pts.map(function (q) { return q[0]; });
    var ys = pts.map(function (q) { return q[1]; });
    var x0 = Math.min.apply(null, xs) - 20;
    var y0 = Math.min.apply(null, ys) - 20;
    return {
      el: svg,
      nodes: nodes,
      arrow: true,
      box: { x: x0 / U, y: y0 / U, w: (Math.max.apply(null, xs) + 20 - x0) / U, h: (Math.max.apply(null, ys) + 20 - y0) / U },
      highlight: function (t) {
        tl.to(p, { attr: { stroke: "#7a2be0" }, duration: 0.25 }, t);
        tl.to(head, { attr: { fill: "#7a2be0" }, duration: 0.25 }, t);
      },
      pulse: function (t) {
        tl.to(p, { attr: { "stroke-width": 8 }, duration: 0.15, yoyo: true, repeat: 1, ease: "power2.out" }, t);
      },
      enter: function (t) {
        if (e.dashed) tl.fromTo(p, { opacity: 0 }, { opacity: 1, duration: 0.3 }, t);
        else tl.fromTo(p, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.38, ease: "power2.inOut" }, t);
        tl.fromTo(head, { opacity: 0 }, { opacity: 1, duration: 0.1 }, t + 0.3);
        if (label) riseIn(label, t + 0.25, { y: 8, d: 0.25 });
      },
      flow: function (t, until) {
        var legs = [];
        var total = 0;
        for (var i = 1; i < pts.length; i++) {
          var len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
          legs.push(len);
          total += len;
        }
        var trip = Math.max(0.5, Math.min(1.1, total / 700));
        var runs = Math.max(1, Math.min(4, Math.floor((until - t) / (trip + 0.2))));
        for (var r = 0; r < runs; r++) {
          var t0 = t + r * (trip + 0.2);
          var keys = [];
          for (var j = 1; j < pts.length; j++) keys.push({ x: pts[j][0] - pts[0][0], y: pts[j][1] - pts[0][1], duration: (trip * legs[j - 1]) / total, ease: "none" });
          tl.fromTo(packet, { x: 0, y: 0, opacity: 1 }, { keyframes: keys, immediateRender: false }, t0);
          tl.to(packet, { opacity: 0, duration: 0.1 }, t0 + trip);
        }
      },
    };
  }

  // ---------- actions ----------
  // Every node that belongs to an item (its body, an arrow's label and packets,
  // badges and strikes added later) with where it was drawn, so dim, exit,
  // shake and move treat the item as one thing.
  function adopt(item, el) {
    item.nodes.push({ el: el, home: { x: item.pos.x, y: item.pos.y } });
  }
  function nodesOf(item) {
    return item.nodes.map(function (n) { return n.el; });
  }
  function badge(item, good, t) {
    var r = rectOf(item);
    var el = h("div", "badge " + (good ? "ok" : "bad"), "left:" + (r.x + r.w - 26) + "px;top:" + (r.y - 22) + "px;width:52px;height:52px;z-index:4", item.layer, good ? CHECK : CROSS);
    adopt(item, el);
    popIn(el, t, { from: 0.2, ease: "back.out(3)" });
    sfx("pop", t, -16);
  }
  // Where the camera pushes in for a focus. Nothing else on screen may end up
  // half in frame (that reads as a glitch): the view shifts to push it fully
  // out while keeping the targets in, or takes it in too. A push-in that would
  // barely zoom is skipped.
  function focusView(targets, sc) {
    var box = null;
    function grow(q) {
      box = box ? { x0: Math.min(box.x0, q.x), y0: Math.min(box.y0, q.y), x1: Math.max(box.x1, q.x + q.w), y1: Math.max(box.y1, q.y + q.h) } : { x0: q.x, y0: q.y, x1: q.x + q.w, y1: q.y + q.h };
    }
    targets.forEach(function (it) { grow(rectOf(it)); });
    var others = Object.keys(sc.items)
      .map(function (id) { return sc.items[id]; })
      // Lines running out of frame read fine; only cut cards look broken.
      .filter(function (it) { return targets.indexOf(it) < 0 && !it.gone && !it.arrow; });
    for (var pass = 0; pass < 6; pass++) {
      var s = Math.min(1.7, Math.min((1920 * 0.68) / (box.x1 - box.x0), (1080 * 0.68) / (box.y1 - box.y0)));
      if (s < 1.08) return null;
      var hw = 960 / s, hh = 540 / s;
      var cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
      var cut = null;
      for (var k = 0; k < others.length && !cut; k++) {
        var q = rectOf(others[k]);
        var ix = Math.max(0, Math.min(q.x + q.w, cx + hw) - Math.max(q.x, cx - hw));
        var iy = Math.max(0, Math.min(q.y + q.h, cy + hh) - Math.max(q.y, cy - hh));
        var frac = (ix * iy) / Math.max(1, q.w * q.h);
        if (frac > 0.01 && frac < 0.97) cut = q;
      }
      if (!cut) return { s: s, cx: cx, cy: cy };
      // Push it fully out along one axis if the targets still fit.
      var shifted = false;
      if (cut.x >= box.x1 && cut.x - 16 - 2 * hw >= box.x0 - 60) { cx = cut.x - 16 - hw; shifted = true; }
      else if (cut.x + cut.w <= box.x0 && cut.x + cut.w + 16 + 2 * hw <= box.x1 + 60) { cx = cut.x + cut.w + 16 + hw; shifted = true; }
      else if (cut.y >= box.y1 && cut.y - 16 - 2 * hh >= box.y0 - 40) { cy = cut.y - 16 - hh; shifted = true; }
      else if (cut.y + cut.h <= box.y0 && cut.y + cut.h + 16 + 2 * hh <= box.y1 + 40) { cy = cut.y + cut.h + 16 + hh; shifted = true; }
      if (shifted) {
        var clean = others.every(function (it) {
          var r = rectOf(it);
          var jx = Math.max(0, Math.min(r.x + r.w, cx + hw) - Math.max(r.x, cx - hw));
          var jy = Math.max(0, Math.min(r.y + r.h, cy + hh) - Math.max(r.y, cy - hh));
          var f = (jx * jy) / Math.max(1, r.w * r.h);
          return f <= 0.01 || f >= 0.97;
        });
        if (clean) return { s: s, cx: cx, cy: cy };
      }
      grow(cut);
    }
    return null;
  }
  // The directed camera: each beat frames what is on screen by its end, inside
  // the area the label and captions leave free, so a scene opens close on its
  // first element and widens as it builds. Focus pushes in from there; reset
  // returns to it.
  var AUTO_MAX = 1.45;
  function autoView(sc) {
    var box = null;
    Object.keys(sc.items).forEach(function (id) {
      var it = sc.items[id];
      if (it.gone) return;
      var q = rectOf(it);
      box = box ? { x0: Math.min(box.x0, q.x), y0: Math.min(box.y0, q.y), x1: Math.max(box.x1, q.x + q.w), y1: Math.max(box.y1, q.y + q.h) } : { x0: q.x, y0: q.y, x1: q.x + q.w, y1: q.y + q.h };
    });
    if (!box) return { s: 1, x: 0, y: 0 };
    var L = 110, R = 1810, TOP = 125, BOT = 895;
    var s = Math.max(1, Math.min(AUTO_MAX, (R - L) / (box.x1 - box.x0 + 70), (BOT - TOP) / (box.y1 - box.y0 + 70)));
    var x = (L + R) / 2 - s * (box.x0 + box.x1) / 2;
    var y = (TOP + BOT) / 2 - s * (box.y0 + box.y1) / 2;
    // Content bigger than the safe area is never pushed further out of it
    // than the designer placed it (under the label or the captions).
    x = Math.max(Math.min(x, Math.max(box.x1, R) - s * box.x1), Math.min(box.x0, L) - s * box.x0);
    y = Math.max(Math.min(y, Math.max(box.y1, BOT) - s * box.y1), Math.min(box.y0, TOP) - s * box.y0);
    return { s: s, x: x, y: y };
  }
  function camTo(sc, v, t, d) {
    if (t == null) tl.set(sc.cam, { scale: v.s, x: v.x, y: v.y }, sc.tIn);
    else tl.to(sc.cam, { scale: v.s, x: v.x, y: v.y, duration: d || 0.9, ease: "power2.inOut" }, t);
    sc.view = v;
  }
  function applyAction(a, t, sc) {
    var items = sc.items;
    var targets = (a.target || []).map(function (id) { return items[id]; }).filter(Boolean);
    var first = targets[0];
    switch (a.do) {
      case "highlight":
        if (!first) return;
        if (first.built.highlight) first.built.highlight(t);
        else if (first.built.bar && a.lines && a.lines.length) {
          a.lines.forEach(function (n) { var b = first.built.bar(n); if (b) tl.fromTo(b, { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power3.out" }, t); });
        } else if (first.built.rowBar && a.rows && a.rows.length) {
          a.rows.forEach(function (n) { var b = first.built.rowBar(n); if (b) tl.fromTo(b, { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power3.out" }, t); });
        } else if (first.built.dark) {
          tl.to(first.el, { boxShadow: "7px 7px 0 #7a2be0, 0 0 0 7px rgba(189,133,251,0.75)", duration: 0.25 }, t);
          tl.to(first.el, { scale: 1.03, duration: 0.14, yoyo: true, repeat: 1, ease: "power2.out" }, t);
        } else {
          tl.to(first.el, { backgroundColor: "#dcc2ff", duration: 0.25 }, t);
          tl.to(first.el, { scale: 1.05, duration: 0.14, yoyo: true, repeat: 1, ease: "power2.out" }, t);
        }
        sfx("tick", t, -17);
        break;
      case "dim":
        targets.forEach(function (it) { tl.to(nodesOf(it), { opacity: 0.28, duration: 0.3 }, t); });
        break;
      case "restore":
        targets.forEach(function (it) {
          tl.to(nodesOf(it), { opacity: 1, duration: 0.3 }, t);
          it.gone = false;
        });
        break;
      case "exit":
        targets.forEach(function (it) {
          tl.to(nodesOf(it), { opacity: 0, duration: 0.25, ease: "power2.in" }, t);
          // An arrow spans the canvas; shrinking it would slide it sideways.
          if (!it.arrow) tl.to(it.el, { scale: 0.9, duration: 0.25, ease: "power2.in" }, t);
          it.gone = true;
        });
        break;
      case "strike":
        if (!first) return;
        var r = rectOf(first);
        var line = h("div", "", "position:absolute;left:" + (r.x + 10) + "px;top:" + (r.y + r.h / 2 - 2) + "px;width:" + (r.w - 20) + "px;height:5px;border-radius:3px;background:#b3263a;transform-origin:left center;z-index:4", first.layer);
        adopt(first, line);
        tl.fromTo(line, { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power2.out" }, t);
        tl.to(first.el, { opacity: 0.55, duration: 0.3 }, t + 0.1);
        (first.strikes = first.strikes || []).push(line);
        sfx("tick", t, -16);
        break;
      case "pulse":
        targets.forEach(function (it) {
          if (it.built.pulse) it.built.pulse(t);
          else tl.to(it.el, { scale: 1.07, duration: 0.15, yoyo: true, repeat: 1, ease: "power2.out" }, t);
        });
        sfx("tick", t, -17);
        break;
      case "shake":
        // Relative, so an element moved earlier shakes where it now stands.
        if (first) tl.to(nodesOf(first), { x: "+=10", duration: 0.05, yoyo: true, repeat: 5, ease: "none" }, t);
        break;
      case "check":
      case "cross":
        if (first) badge(first, a.do === "check", t);
        break;
      case "replace":
        if (!first || !first.swaps || !first.swaps.length) return;
        var next = first.swaps.shift();
        var old = first.current;
        // New words are not struck out: a replacement clears any strike.
        if (first.strikes && first.strikes.length) {
          var struck = first.strikes;
          tl.to(struck, { opacity: 0, duration: 0.2 }, t);
          tl.to(first.el, { opacity: 1, duration: 0.25 }, t + 0.1);
          first.nodes = first.nodes.filter(function (n) { return struck.indexOf(n.el) < 0; });
          first.strikes = [];
        }
        tl.to(old, { opacity: 0, y: -22, duration: 0.2, ease: "power2.in" }, t);
        tl.fromTo(next, { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.28, ease: "power3.out" }, t + 0.12);
        first.current = next;
        sfx("tick", t, -17);
        break;
      case "count":
        if (!first || !first.built.counts || !first.built.counts.length) return;
        var c = first.built.counts.shift();
        tl.to(first.built.first, { opacity: 0, duration: 0.15 }, t);
        tl.to(c.wrap, { opacity: 1, duration: 0.1 }, t + 0.05);
        c.od.roll(t + 0.05);
        first.built.first = c.wrap;
        sfx("tick", t, -16);
        break;
      case "move":
        if (!first || first.arrow) return;
        first.nodes.forEach(function (n) {
          tl.to(n.el, { x: (Number(a.x) - n.home.x) * U, y: (Number(a.y) - n.home.y) * U, duration: 0.55, ease: "power3.inOut" }, t);
        });
        first.pos = { x: Number(a.x), y: Number(a.y), w: first.pos.w, h: first.pos.h };
        break;
      case "type":
        if (!first || !first.built.pending || !first.built.pending.length) return;
        var n = first.built.pending.shift();
        tl.set(n, { opacity: 1 }, t);
        typeIn(n, t, Math.min(0.6, 0.05 + (n.textContent || "").length * 0.015));
        sfx("tick", t, -18);
        break;
      case "flow":
        if (first && first.built.flow) first.built.flow(t, sc.tOut - 0.3);
        break;
      case "scan":
        if (!first) return;
        var rr = rectOf(first);
        var bar = h("div", "", "position:absolute;left:" + rr.x + "px;top:" + (rr.y - 10) + "px;width:6px;height:" + (rr.h + 20) + "px;border-radius:3px;background:#7a2be0;box-shadow:0 0 36px 12px rgba(122,43,224,0.3);z-index:5;opacity:0", first.layer);
        tl.fromTo(bar, { x: 0, opacity: 1 }, { x: rr.w, duration: 0.9, ease: "power1.inOut", immediateRender: false }, t);
        tl.to(bar, { opacity: 0, duration: 0.15 }, t + 0.9);
        break;
      case "focus":
        if (!targets.length) return;
        var view = focusView(targets, sc);
        // A push-in that would barely zoom past the framing is skipped.
        if (!view || view.s < sc.view.s * 1.08) break;
        tl.to(sc.cam, { scale: view.s, x: 960 - view.s * view.cx, y: 540 - view.s * view.cy, duration: 0.75, ease: "power3.inOut" }, t);
        sc.view = { s: view.s, x: 960 - view.s * view.cx, y: 540 - view.s * view.cy };
        sc.focused = true;
        break;
      case "reset":
        camTo(sc, autoView(sc), t, 0.65);
        sc.focused = false;
        break;
    }
  }

  // ---------- assemble ----------
  // Offline renders paint on the CPU, where any motion that spans the whole
  // frame (background drift, glow pulse, scene drift) repaints every pixel of
  // every frame; they are near invisible after compression, so renders hold them.
  var RENDER = document.documentElement.classList.contains("render");
  if (!RENDER) {
    tl.fromTo("#bg-grid", { x: 0, y: 0 }, { x: -40, y: -40, duration: DUR, ease: "none" }, 0);
    tl.fromTo("#bg-glow", { scale: 1, opacity: 0.85 }, { scale: 1.12, opacity: 1, duration: 5, ease: "sine.inOut", yoyo: true, repeat: Math.max(0, Math.floor(DUR / 5) - 1) }, 0);
  }

  scenes.forEach(function (sc, k) {
    var sec = h("section", "scene", "", stage);
    var inner = h("div", "inner", "", sec);
    var drift = h("div", "", "position:absolute;inset:0;transform-origin:50% 46%", inner);
    var cam = h("div", "", "position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0", drift);
    sc.cam = cam;
    sc.items = dict();
    sc.view = { s: 1, x: 0, y: 0 };
    tl.set(sec, { visibility: "visible" }, sc.tIn);
    transitionIn(inner, sc.transition, sc.tIn);
    if (!RENDER) tl.fromTo(drift, { scale: 1 }, { scale: 1.015, duration: Math.max(0.5, sc.tOut - sc.tIn), ease: "none" }, sc.tIn);
    transitionOut(inner, (scenes[k + 1] && scenes[k + 1].transition) || "zoom", sc.tOut);
    tl.set(sec, { visibility: "hidden" }, sc.tOut);
    sfxScene = k;
    if (k > 0) sfx("whoosh", sc.tIn - 0.04, -17, 1, true);

    // Actions that later need prepared DOM (swaps, counts, typed lines).
    var future = dict();
    sc.beats.forEach(function (bi) {
      beats[bi].actions.forEach(function (a) {
        (a.target || []).forEach(function (id) { (future[id] = future[id] || []).push(a); });
      });
    });

    var empty = true;
    sc.beats.forEach(function (bi, j) {
      var beat = beats[bi];
      var floor = j === 0 ? sc.tIn + 0.3 : TB[bi].start - 0.05;
      // Cue times follow the plan's order, but every arrow is built after the
      // elements it joins, wherever the designer listed it.
      var stagger = 0;
      var timed = beat.elements.map(function (e) {
        var cued = cueTime(bi, e.at);
        return { e: e, t: Math.max(floor, cued == null ? TB[bi].start + 0.06 + 0.13 * stagger++ : cued - 0.04) };
      });
      var arrowsLast = timed.filter(function (x) { return x.e.kind !== "arrow"; }).concat(timed.filter(function (x) { return x.e.kind === "arrow"; }));
      arrowsLast.forEach(function (x) {
        var e = x.e;
        var t = x.t;
        var built;
        if (e.kind === "arrow") {
          built = buildArrow(e, cam, sc.items);
          // Never drawn before both of its ends are on screen.
          if (built) t = Math.max(t, sc.items[e.from].t, sc.items[e.to].t);
        } else if (B[e.kind]) built = B[e.kind](e, cam, future[e.id] || []);
        if (!built) return;
        empty = false;
        var pos = built.box || { x: e.x, y: e.y, w: e.w, h: e.h };
        var item = { built: built, el: built.el, t: t, arrow: Boolean(built.arrow), pos: pos, layer: cam, nodes: [] };
        (built.nodes || [built.el]).forEach(function (n) { adopt(item, n); });
        if (built.label && built.labelHost) {
          var swaps = (future[e.id] || []).filter(function (a) { return a.do === "replace"; });
          item.current = built.label;
          var host = built.labelHost;
          if (getComputedStyle(host).position === "static") host.style.position = "relative";
          var lab = built.label;
          item.swaps = swaps.map(function (a) {
            var clone = lab.cloneNode(false);
            clone.innerHTML = e.kind === "heading" ? accentHtml(a.text) : esc(a.text);
            clone.style.position = "absolute";
            clone.style.margin = "0";
            clone.style.left = lab.offsetLeft + "px";
            clone.style.top = lab.offsetTop + "px";
            clone.style.width = Math.max(lab.offsetWidth, 40) + "px";
            if (e.kind === "chip" || e.kind === "stamp") clone.style.textAlign = "center";
            clone.style.opacity = 0;
            host.appendChild(clone);
            // Replacement text is often longer than the original: give it the
            // host's whole inner width (centered pills stay centered), then fit.
            var hs = getComputedStyle(host);
            var padL = parseFloat(hs.paddingLeft) || 0;
            var room = host.clientWidth - padL - (parseFloat(hs.paddingRight) || 0);
            if (e.kind === "chip" || e.kind === "stamp") {
              clone.style.left = padL + "px";
              clone.style.width = room + "px";
            } else clone.style.width = Math.max(lab.offsetWidth, host.clientWidth - lab.offsetLeft - (parseFloat(hs.paddingRight) || 0)) + "px";
            fitText(clone, host.clientHeight - lab.offsetTop, 12);
            return clone;
          });
        }
        sc.items[e.id] = item;
        built.enter(t);
        // An arrow marked "flow" runs packets once drawn, unless a flow action
        // starts them on a later word.
        if (e.flow && built.flow && !(future[e.id] || []).some(function (a) { return a.do === "flow"; })) built.flow(t + 0.45, sc.tOut - 0.3);
      });
      // Every beat is framed as it starts, unless the camera is pushed in and
      // nothing new appears (a focus holds across such beats).
      if (!(j > 0 && sc.focused && !beat.elements.length)) {
        camTo(sc, autoView(sc), j === 0 ? null : TB[bi].start - 0.3);
        sc.focused = false;
      }
      beat.actions.forEach(function (a) {
        var cued = cueTime(bi, a.at);
        var t = Math.max(floor + 0.35, cued == null ? (TB[bi].start + TB[bi].end) / 2 : cued - 0.03);
        applyAction(a, Math.min(t, sc.tOut - 0.35), sc);
      });
    });

    // A scene the designer never delivered still says its line on screen.
    if (empty) {
      var fallback = sc.beats.map(function (bi) { return beats[bi].narration; }).join(" ");
      var built = B.heading({ text: fallback, x: 1, y: 2.2, w: 14, h: 4.5 }, cam);
      built.enter(sc.tIn + 0.3);
    }
  });

  // ---------- chrome: repo label, progress hairline, end card ----------
  var label = document.getElementById("brand");
  label.innerHTML = GLYPH +
    '<span style="font:600 23px/1 Geist;letter-spacing:-0.01em;color:var(--ink)">Git<span style="font-weight:600;color:#9333ea">Diagram</span></span>' +
    '<i style="width:2px;height:22px;border-radius:1px;background:rgba(23,17,31,0.16)"></i>' +
    '<span class="mono" style="font:600 22px/1 \'Geist Mono\';color:var(--ink)">' + esc(M.owner + "/" + M.repo) + "</span>";
  label.style.cssText += ";gap:12px;padding:8px 16px 8px 10px;border-radius:999px;background:rgba(242,232,255,0.92);border:2px solid rgba(23,17,31,0.12);z-index:20";
  riseIn(label, 0.2, { y: -14, d: 0.5 });
  tl.to(label, { opacity: 0, duration: 0.3 }, endAt - 0.1);

  var rail = document.getElementById("rail");
  var hair = h("div", "", "position:absolute;left:0;bottom:0;width:1920px;height:6px;background:#7a2be0;transform-origin:left center", rail);
  tl.fromTo(hair, { scaleX: 0 }, { scaleX: 1, duration: DUR, ease: "none" }, 0);

  var end = h("section", "scene", "", stage);
  var endInner = h("div", "inner", "display:flex;flex-direction:column;justify-content:center;padding:0 150px", end);
  var outro = S.outro || S.title;
  var os = fitSize(outro.replace(/\*/g, ""), function (s) { return "400 " + s + 'px "Instrument Serif"'; }, 1620, 420, 1.02, 150, 60);
  var line = h("div", "serif", "font-size:" + os + "px;line-height:1.02;letter-spacing:-0.02em;max-width:1620px", endInner);
  var words = accentWords(outro).map(function (w) {
    var sp = h("span", "hw", "", line, w);
    line.appendChild(document.createTextNode(" "));
    return sp;
  });
  var sign = h("div", "", "margin-top:56px;display:flex;align-items:center;gap:18px", endInner, GLYPH + '<span class="mono" style="font:600 28px/1 \'Geist Mono\'">github.com/' + esc(M.owner + "/" + M.repo) + '</span><span style="font:400 24px/1 Geist;color:var(--ink-2);margin-left:6px">· made with GitDiagram</span>');
  tl.set(end, { visibility: "visible" }, endAt);
  words.forEach(function (sp, k) { tl.fromTo(sp, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, endAt + 0.1 + k * 0.06); });
  riseIn(sign, endAt + 0.5, { y: 20, d: 0.5 });

  mixSfx();
  tl.to({}, { duration: 0.01 }, DUR - 0.01);
  window.__timelines.main = tl;
}
Promise.all(
  ['400 32px "Geist"', '400 32px "Geist Mono"', '400 32px "Instrument Serif"', 'italic 400 32px "Instrument Serif"'].map(function (f) {
    return document.fonts.load(f);
  }),
).then(build);
