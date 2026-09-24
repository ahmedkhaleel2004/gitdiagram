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
  // Version 2 films have no idea card; the stage shell still carries its markup.
  var note = document.getElementById("note");
  if (note) note.style.display = "none";

  // ---------- sound: every event can ask, the throttle keeps it musical ----------
  var SFX = (window.__SFX = []);
  var lastAny = -1;
  var lastByName = {};
  function sfx(name, t, gain) {
    t = Math.max(0, t);
    if (t - lastAny < 0.09 && t >= lastAny) return;
    if (lastByName[name] !== undefined && Math.abs(t - lastByName[name]) < 0.22) return;
    lastAny = t;
    lastByName[name] = t;
    SFX.push({ name: name, t: Number(t.toFixed(3)), gain: gain || 0 });
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
  var KW = {};
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
    if (!ICON[name]) return "";
    return (
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="#17111f" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">' +
      ICON[name] +
      "</svg>"
    );
  }
  var CHECK = '<svg width="24" height="24" viewBox="0 0 22 22" fill="none" stroke="#0f7a48" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11 L9 16 L18 6"/></svg>';
  var CROSS = '<svg width="24" height="24" viewBox="0 0 22 22" fill="none" stroke="#b3263a" stroke-width="4" stroke-linecap="round"><path d="M5 5 L17 17 M17 5 L5 17"/></svg>';
  var GLYPH = '<svg width="34" height="34" viewBox="0 0 46 46" fill="none" stroke="#17111f" stroke-width="3.5"><rect x="3" y="3" width="16" height="16" rx="3" fill="#bd85fb"/><rect x="27" y="3" width="16" height="16" rx="3" fill="#fdfaff"/><rect x="15" y="27" width="16" height="16" rx="3" fill="#dcc2ff"/><path d="M19 11 H27 M35 19 V23 H23 V27"/></svg>';
  var TONE_BG = { plain: "var(--card)", accent: "var(--purple)", soft: "var(--purple-soft)", ok: "var(--green-soft)", bad: "var(--red-soft)", ghost: "transparent" };
  var TONE_INK = { plain: INK, accent: INK, soft: INK, ok: "#0f7a48", bad: "#b3263a", ghost: INK };
  var PAINT = { none: "none", paper: "#f2e8ff", card: "#fdfaff", accent: "#bd85fb", soft: "#dcc2ff", ink: INK, ok: "#cff2de", bad: "#ffd9da" };

  // ---------- clock ----------
  function norm(w) {
    return String(w || "").toLowerCase().replace(/[^a-z0-9.#/]/g, "").replace(/\.$/, "");
  }
  function cueTime(bi, word) {
    var c = norm(word);
    if (!c) return null;
    var ws = TB[bi].words;
    for (var k = 0; k < ws.length; k++) {
      var w = ws[k].w;
      if (w === c || (c.length > 3 && w.indexOf(c) === 0) || (w.length > 3 && c.indexOf(w) === 0)) return ws[k].s;
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
  // Each returns { el, enter(t), parts } where parts serve later actions.
  function place(parent, e, extra) {
    return h(
      "div",
      "shot",
      "position:absolute;left:" + e.x * U + "px;top:" + e.y * U + "px;width:" + e.w * U + "px;height:" + e.h * U + "px;" + (extra || ""),
      parent,
    );
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
  function swapNode(host, style, html) {
    var n = h("div", "", "position:absolute;inset:0;display:flex;align-items:center;" + style, host, html);
    n.style.opacity = 0;
    return n;
  }

  var B = {};
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
    return { el: el, label: inner, labelHost: el, enter: function (t) { riseIn(el, t, { y: 18, d: 0.36 }); } };
  };
  B.code = function (e, layer, future) {
    var el = place(layer, e, cardStyle());
    h("div", "panel-head", "height:52px;font-size:18px;letter-spacing:0.02em", el, esc(e.title || ""));
    var extra = future.filter(function (a) { return a.do === "type"; }).map(function (a) { return a.line || ""; });
    var all = e.lines.concat(extra);
    var lh = 1.62;
    var fs = monoFit(all, e.w * U - 96, e.h * U - 52 - 26, 25, 17, lh);
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
        (e.focus || []).forEach(function (n) { tl.fromTo(bar(n), { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power3.out" }, t + 0.5); });
        sfx("typing", t + 0.15, -15);
      },
    };
  };
  B.terminal = function (e, layer, future) {
    var el = place(layer, e, "background:#17111f;border:3px solid " + INK + ";border-radius:14px;box-shadow:7px 7px 0 #7a2be0;overflow:hidden;");
    var head = h("div", "", "height:44px;display:flex;align-items:center;gap:9px;padding:0 16px;border-bottom:2px solid #3a2f4a;font:500 16px/1 'Geist Mono';color:#b9a8d6", el);
    head.innerHTML = '<i style="width:12px;height:12px;border-radius:50%;background:#ff6b6b;display:block"></i><i style="width:12px;height:12px;border-radius:50%;background:#ffd166;display:block"></i><i style="width:12px;height:12px;border-radius:50%;background:#7ee2a8;display:block"></i><span style="margin-left:8px">' + esc(e.title || "terminal") + "</span>";
    var extra = future.filter(function (a) { return a.do === "type"; }).map(function (a) { return a.line || ""; });
    var all = e.lines.concat(extra);
    var fs = monoFit(all, e.w * U - 48, e.h * U - 44 - 24, 24, 17, 1.55);
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
        sfx("typing", t + 0.2, -13);
      },
    };
  };
  B.box = function (e, layer) {
    var W = e.w * U;
    var H = e.h * U;
    var tone = e.tone || "plain";
    var ghost = tone === "ghost";
    var el = place(layer, e, cardStyle(TONE_BG[tone]) + (ghost ? "border-style:dashed;box-shadow:none;" : "") + "display:flex;align-items:center;gap:14px;padding:0 20px;");
    var ic = e.icon && e.icon !== "none" ? Math.min(46, H * 0.42) : 0;
    if (ic) el.insertAdjacentHTML("beforeend", icon(e.icon, ic));
    var col = h("div", "", "position:relative;flex:1;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:center", el);
    var tw = W - 44 - (ic ? ic + 14 : 0);
    var ls = fitSize(e.label, function (s) { return "650 " + s + "px Geist"; }, tw, (e.sub ? H * 0.5 : H * 0.72), 1.12, 40, 16);
    var label = h("div", "", "font:650 " + ls + "px/1.12 Geist;color:" + TONE_INK[tone] + ";letter-spacing:-0.01em", col, esc(e.label));
    if (e.sub) {
      var ss = Math.max(14, Math.min(22, Math.floor(tw / (e.sub.length * 0.6)), Math.floor(H * 0.22)));
      h("div", "mono", "margin-top:6px;font:500 " + ss + "px/1.2 'Geist Mono';color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis", col, esc(e.sub));
    }
    return { el: el, label: label, labelHost: col, enter: function (t) { popIn(el, t); sfx("pop", t, -11); } };
  };
  B.chip = function (e, layer) {
    var H = e.h * U;
    var tone = e.tone || "plain";
    var fs = Math.max(15, Math.min(Math.floor(H * 0.42), Math.floor((e.w * U - 36) / (e.text.length * 0.6))));
    var el = place(layer, e, "display:flex;align-items:center;justify-content:center;border:3px solid " + INK + ";border-radius:999px;background:" + TONE_BG[tone] + ";box-shadow:3px 3px 0 " + INK + ";padding:0 18px;font:600 " + fs + "px/1 'Geist Mono';color:" + TONE_INK[tone] + ";white-space:nowrap;overflow:hidden");
    var label = h("span", "", "", el, esc(e.text));
    return { el: el, label: label, labelHost: el, enter: function (t) { popIn(el, t, { from: 0.5 }); sfx("tick", t, -14); } };
  };
  B.file = function (e, layer) {
    var H = e.h * U;
    var parts = String(e.path).split("/");
    var name = parts.pop();
    var dir = parts.join("/");
    var el = place(layer, e, cardStyle() + "display:flex;align-items:center;gap:14px;padding:0 18px;");
    el.insertAdjacentHTML("beforeend", icon("file", Math.min(40, H * 0.5)));
    var col = h("div", "", "min-width:0", el);
    var ns = Math.max(16, Math.min(Math.floor(H * 0.34), Math.floor((e.w * U - 90) / (name.length * 0.6)), 30));
    h("div", "mono", "font:650 " + ns + "px/1.15 'Geist Mono';white-space:nowrap", col, esc(name));
    if (dir) h("div", "mono", "margin-top:4px;font:500 " + Math.max(13, ns - 8) + "px/1.2 'Geist Mono';color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis", col, esc(dir + "/"));
    return { el: el, enter: function (t) { riseIn(el, t, { x: -40, y: 0, d: 0.36 }); sfx("paper", t, -17); } };
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
    e.paths.forEach(function (p, i) {
      rows.push(h("div", "mono", "position:relative;height:" + rh + "px;padding-left:28px;font:500 " + fs + "px/" + rh + "px 'Geist Mono';white-space:nowrap", body, esc(p)));
    });
    function bar(i) {
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
        (e.focus || []).forEach(function (i) { tl.fromTo(bar(i), { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power3.out" }, t + 0.5); });
        sfx("tick", t + 0.2, -15);
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
        sfx("tick", t + 0.2, -15);
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
    var fills = [];
    e.items.forEach(function (it, i) {
      var r = h("div", "", "position:absolute;left:0;right:0;top:" + i * rh + "px;height:" + rh + "px;display:flex;align-items:center;gap:14px", el);
      h("div", "", "width:" + labelW + "px;flex-shrink:0;text-align:right;font:600 " + fs + "px/1.1 Geist;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", r, esc(it.label));
      var track = h("div", "", "position:relative;flex:1;height:" + Math.min(46, rh * 0.62) + "px", r);
      var width = Math.max(0.04, Math.abs(it.value) / max);
      var fill = h("div", "", "position:absolute;left:0;top:0;bottom:0;width:" + width * 82 + "%;border:3px solid " + INK + ";border-radius:8px;background:" + (i === 0 ? "var(--purple)" : "var(--purple-soft)") + ";box-shadow:3px 3px 0 " + INK + ";transform-origin:left center", track);
      h("div", "mono", "position:absolute;left:calc(" + width * 82 + "% + 12px);top:50%;transform:translateY(-50%);font:650 " + fs + "px/1 'Geist Mono';white-space:nowrap", track, esc(fmt(it.value) + (e.unit ? " " + e.unit : "")));
      fills.push(fill);
    });
    return {
      el: el,
      enter: function (t) {
        tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.2 }, t);
        fills.forEach(function (f, i) { tl.fromTo(f, { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: "power3.out" }, t + 0.1 + i * 0.08); });
        sfx("blip", t + 0.1, -14);
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
      return { at: a, od: odometer(wrapEl, Number(a.value) || 0, e.prefix, e.suffix, size), wrap: wrapEl };
    });
    if (label) h("div", "", "margin-top:12px;font:500 " + Math.max(16, Math.min(28, Math.floor(H * 0.16))) + "px/1.2 Geist;color:var(--ink-2)", el, esc(e.label));
    return {
      el: el,
      first: first.row,
      counts: later,
      enter: function (t) { riseIn(el, t, { y: 20, d: 0.3 }); first.roll(t + 0.05); sfx("tick", t + 0.1, -12); },
    };
  };
  B.stamp = function (e, layer) {
    var tone = e.tone === "ok" ? "#0f7a48" : e.tone === "bad" ? "#b3263a" : "#7a2be0";
    var bg = e.tone === "ok" ? "rgba(207,242,222,0.9)" : e.tone === "bad" ? "rgba(255,217,218,0.9)" : "rgba(220,194,255,0.9)";
    var fs = Math.max(20, Math.min(Math.floor(e.h * U * 0.5), Math.floor((e.w * U - 48) / (e.text.length * 0.68))));
    var el = place(layer, e, "display:flex;align-items:center;justify-content:center;border:6px solid " + tone + ";border-radius:14px;color:" + tone + ";background:" + bg + ";font:820 " + fs + "px/1 Geist;letter-spacing:0.05em;white-space:nowrap");
    var label = h("span", "", "", el, esc(e.text));
    return {
      el: el,
      label: label,
      labelHost: el,
      enter: function (t) {
        tl.fromTo(el, { opacity: 0, scale: 1.9, rotation: -14 }, { opacity: 1, scale: 1, rotation: -6, duration: 0.2, ease: "power4.in" }, t);
        sfx("stamp", t + 0.15, -2);
      },
    };
  };
  B.browser = function (e, layer) {
    var el = place(layer, e, cardStyle("var(--paper-2)"));
    var bar = h("div", "", "height:54px;display:flex;align-items:center;gap:14px;padding:0 18px;border-bottom:3px solid " + INK + ";background:var(--card)", el);
    bar.innerHTML = '<div class="dots"><i></i><i></i><i></i></div>';
    h("div", "mono", "flex:1;height:34px;display:flex;align-items:center;padding:0 16px;border:2px solid " + INK + ";border-radius:999px;font:500 18px/1 'Geist Mono';white-space:nowrap;overflow:hidden;text-overflow:ellipsis", bar, esc(e.url || ""));
    return { el: el, enter: function (t) { riseIn(el, t, { y: 40 }); sfx("paper", t, -17); } };
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
        sfx("blip", t, -13);
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
      node.setAttribute("fill", PAINT[s.fill] || "none");
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
    var label = null;
    if (e.label) {
      var mid = pts[Math.floor((pts.length - 1) / 2)];
      var nxt = pts[Math.floor((pts.length - 1) / 2) + 1];
      label = h("div", "mono", "position:absolute;left:" + ((mid[0] + nxt[0]) / 2 - 130) + "px;top:" + ((mid[1] + nxt[1]) / 2 - 17) + "px;width:260px;text-align:center;font:600 18px/34px 'Geist Mono';color:var(--ink-2)", layer, '<span style="background:var(--paper);padding:3px 9px;border-radius:6px">' + esc(e.label) + "</span>");
    }
    var packet = h("div", "", "position:absolute;left:" + (pts[0][0] - 11) + "px;top:" + (pts[0][1] - 11) + "px;width:22px;height:22px;border-radius:50%;background:#7a2be0;border:3px solid " + INK + ";opacity:0", layer);
    return {
      el: svg,
      packet: packet,
      pts: pts,
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
        sfx("blip", t, -13);
      },
    };
  }

  // ---------- actions ----------
  function badge(item, good, t) {
    var r = rectOf(item);
    var el = h("div", "badge " + (good ? "ok" : "bad"), "left:" + (r.x + r.w - 26) + "px;top:" + (r.y - 22) + "px;width:52px;height:52px;z-index:4", item.layer, good ? CHECK : CROSS);
    popIn(el, t, { from: 0.2, ease: "back.out(3)" });
    sfx(good ? "check" : "reject", t, good ? -10 : -7);
  }
  function applyAction(a, t, sc, bi) {
    var items = sc.items;
    var targets = (a.target || []).map(function (id) { return items[id]; }).filter(Boolean);
    var first = targets[0];
    switch (a.do) {
      case "highlight":
        if (!first) return;
        if (first.built.bar && a.lines && a.lines.length) {
          a.lines.forEach(function (n) { tl.fromTo(first.built.bar(n), { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power3.out" }, t); });
        } else if (first.built.rowBar && a.rows && a.rows.length) {
          a.rows.forEach(function (n) { var b = first.built.rowBar(n); if (b) tl.fromTo(b, { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power3.out" }, t); });
        } else {
          tl.to(first.el, { backgroundColor: "#dcc2ff", duration: 0.25 }, t);
          tl.to(first.el, { scale: 1.05, duration: 0.14, yoyo: true, repeat: 1, ease: "power2.out" }, t);
        }
        sfx("tick", t, -11);
        break;
      case "dim":
        targets.forEach(function (it) { tl.to(it.el, { opacity: 0.28, duration: 0.3 }, t); });
        break;
      case "restore":
        targets.forEach(function (it) { tl.to(it.el, { opacity: 1, duration: 0.3 }, t); });
        break;
      case "exit":
        targets.forEach(function (it) { tl.to(it.el, { opacity: 0, scale: 0.9, duration: 0.25, ease: "power2.in" }, t); });
        break;
      case "strike":
        if (!first) return;
        var r = rectOf(first);
        var line = h("div", "", "position:absolute;left:" + (r.x + 10) + "px;top:" + (r.y + r.h / 2 - 2) + "px;width:" + (r.w - 20) + "px;height:5px;border-radius:3px;background:#b3263a;transform-origin:left center;z-index:4", first.layer);
        tl.fromTo(line, { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power2.out" }, t);
        tl.to(first.el, { opacity: 0.55, duration: 0.3 }, t + 0.1);
        sfx("reject", t, -9);
        break;
      case "pulse":
        targets.forEach(function (it) { tl.to(it.el, { scale: 1.07, duration: 0.15, yoyo: true, repeat: 1, ease: "power2.out" }, t); });
        sfx("tick", t, -12);
        break;
      case "shake":
        if (first) tl.to(first.el, { x: 10, duration: 0.05, yoyo: true, repeat: 5, ease: "none" }, t);
        sfx("reject", t, -8);
        break;
      case "check":
      case "cross":
        if (first) badge(first, a.do === "check", t);
        break;
      case "replace":
        if (!first || !first.swaps || !first.swaps.length) return;
        var next = first.swaps.shift();
        var old = first.current;
        tl.to(old, { opacity: 0, y: -22, duration: 0.2, ease: "power2.in" }, t);
        tl.fromTo(next, { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.28, ease: "power3.out" }, t + 0.12);
        first.current = next;
        sfx("blip", t, -11);
        break;
      case "count":
        if (!first || !first.built.counts || !first.built.counts.length) return;
        var c = first.built.counts.shift();
        tl.to(first.built.first, { opacity: 0, duration: 0.15 }, t);
        tl.to(c.wrap, { opacity: 1, duration: 0.1 }, t + 0.05);
        c.od.roll(t + 0.05);
        first.built.first = c.wrap;
        sfx("tick", t, -11);
        break;
      case "move":
        if (!first) return;
        tl.to(first.el, { x: (Number(a.x) - first.home.x) * U, y: (Number(a.y) - first.home.y) * U, duration: 0.55, ease: "power3.inOut" }, t);
        first.pos = { x: Number(a.x), y: Number(a.y), w: first.pos.w, h: first.pos.h };
        break;
      case "type":
        if (!first || !first.built.pending || !first.built.pending.length) return;
        var n = first.built.pending.shift();
        tl.set(n, { opacity: 1 }, t);
        typeIn(n, t, Math.min(0.6, 0.05 + (n.textContent || "").length * 0.015));
        sfx("typing", t, -14);
        break;
      case "flow":
        if (first && first.built.flow) first.built.flow(t, sc.tOut - 0.3);
        break;
      case "scan":
        if (!first) return;
        var rr = rectOf(first);
        var bar = h("div", "", "position:absolute;left:" + rr.x + "px;top:" + (rr.y - 10) + "px;width:6px;height:" + (rr.h + 20) + "px;border-radius:3px;background:#7a2be0;box-shadow:0 0 36px 12px rgba(122,43,224,0.3);z-index:5;opacity:0", first.layer);
        tl.fromTo(bar, { x: 0, opacity: 1 }, { x: rr.w, duration: 0.9, ease: "power1.inOut" }, t);
        tl.to(bar, { opacity: 0, duration: 0.15 }, t + 0.9);
        sfx("blip", t, -14);
        break;
      case "focus":
        if (!targets.length) return;
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        targets.forEach(function (it) {
          var q = rectOf(it);
          x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x + q.w); y1 = Math.max(y1, q.y + q.h);
        });
        var s = Math.max(1.1, Math.min(1.7, Math.min((1920 * 0.68) / (x1 - x0), (1080 * 0.68) / (y1 - y0))));
        var cx = (x0 + x1) / 2;
        var cy = (y0 + y1) / 2;
        tl.to(sc.cam, { scale: s, x: 960 - s * cx, y: 540 - s * cy, duration: 0.75, ease: "power3.inOut" }, t);
        sfx("whoosh", t, -16);
        break;
      case "reset":
        tl.to(sc.cam, { scale: 1, x: 0, y: 0, duration: 0.65, ease: "power3.inOut" }, t);
        break;
    }
  }

  // ---------- assemble ----------
  tl.fromTo("#bg-grid", { x: 0, y: 0 }, { x: -40, y: -40, duration: DUR, ease: "none" }, 0);
  tl.fromTo("#bg-glow", { scale: 1, opacity: 0.85 }, { scale: 1.12, opacity: 1, duration: 5, ease: "sine.inOut", yoyo: true, repeat: Math.max(0, Math.floor(DUR / 5) - 1) }, 0);

  scenes.forEach(function (sc, k) {
    var sec = h("section", "scene", "", stage);
    var inner = h("div", "inner", "", sec);
    var drift = h("div", "", "position:absolute;inset:0;transform-origin:50% 46%", inner);
    var cam = h("div", "", "position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0", drift);
    sc.cam = cam;
    sc.items = {};
    tl.set(sec, { visibility: "visible" }, sc.tIn);
    transitionIn(inner, sc.transition, sc.tIn);
    tl.fromTo(drift, { scale: 1 }, { scale: 1.015, duration: Math.max(0.5, sc.tOut - sc.tIn), ease: "none" }, sc.tIn);
    transitionOut(inner, (scenes[k + 1] && scenes[k + 1].transition) || "zoom", sc.tOut);
    tl.set(sec, { visibility: "hidden" }, sc.tOut);
    if (k > 0) sfx("whoosh", sc.tIn - 0.04, -12);

    // Actions that later need prepared DOM (swaps, counts, typed lines).
    var future = {};
    sc.beats.forEach(function (bi) {
      beats[bi].actions.forEach(function (a) {
        (a.target || []).forEach(function (id) { (future[id] = future[id] || []).push(a); });
      });
    });

    var empty = true;
    sc.beats.forEach(function (bi, j) {
      var beat = beats[bi];
      var floor = j === 0 ? sc.tIn + 0.3 : TB[bi].start - 0.05;
      var stagger = 0;
      beat.elements.forEach(function (e) {
        var cued = cueTime(bi, e.at);
        var t = Math.max(floor, cued == null ? TB[bi].start + 0.06 + 0.13 * stagger++ : cued - 0.04);
        var built;
        if (e.kind === "arrow") built = buildArrow(e, cam, sc.items);
        else if (B[e.kind]) built = B[e.kind](e, cam, future[e.id] || []);
        if (!built) return;
        empty = false;
        var item = { built: built, el: built.el, pos: { x: e.x, y: e.y, w: e.w, h: e.h }, home: { x: e.x, y: e.y }, layer: cam };
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
            return clone;
          });
        }
        sc.items[e.id] = item;
        built.enter(t);
      });
      beat.actions.forEach(function (a) {
        var cued = cueTime(bi, a.at);
        var t = Math.max(floor + 0.35, cued == null ? (TB[bi].start + TB[bi].end) / 2 : cued - 0.03);
        applyAction(a, Math.min(t, sc.tOut - 0.35), sc, bi);
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
  label.innerHTML = GLYPH + '<span class="mono" style="font:600 22px/1 \'Geist Mono\';color:var(--ink)">' + esc(M.owner + "/" + M.repo) + "</span>";
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
  sfx("resolve", endAt + 0.05, -6);

  tl.to({}, { duration: 0.01 }, DUR - 0.01);
  window.__timelines.main = tl;
}
document.fonts.ready.then(build);
