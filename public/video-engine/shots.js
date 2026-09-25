// Shot engine: draws a free-form shot plan (window.SPEC, version 2) on the
// narration clock (window.TIMING). Every element and action lands on the word
// that cued it. Model-written text only ever reaches the DOM escaped.
function build() {
  var S = window.SPEC;
  var M = window.META;
  var T = window.TIMING;
  var DUR = T.DURATION;
  var TB = T.beats;
  var NS = "http://www.w3.org/2000/svg";
  var tl = gsap.timeline({ paused: true });
  var stage = document.getElementById("scenes");
  // Helpers and geometry (kit.js, camera.js) and the sound mixer (sound.js).
  var K = window.ShotKit;
  var U = K.U;
  var INK = K.INK;
  var dict = K.dict;
  var own = K.own;
  var esc = K.esc;
  var h = K.h;
  var textW = K.textW;
  var fitSize = K.fitSize;
  var fitText = K.fitText;
  var monoFit = K.monoFit;
  var accentHtml = K.accentHtml;
  var accentWords = K.accentWords;
  var tint = K.tint;
  var icon = K.icon;
  var CHECK = K.CHECK;
  var CROSS = K.CROSS;
  var GLYPH = K.GLYPH;
  var TONE_BG = K.TONE_BG;
  var TONE_INK = K.TONE_INK;
  var PAINT = K.PAINT;
  var toneOf = K.toneOf;
  var norm = K.norm;
  var fmt = K.fmt;
  var rectOf = K.rectOf;
  var route = K.route;
  var pathOf = K.pathOf;
  var lerpRect = K.lerpRect;
  var square = K.square;
  var focusView = K.focusView;
  var autoView = K.autoView;
  // The frame: the wide 1920 × 1080 one, or a tall one for reels (stage.js).
  var F = K.frame;
  var sound = K.sound();
  var sfx = sound.sfx;

  // ---------- clock ----------
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
      status = h("div", "", "padding:6px 12px;border:2.5px solid " + INK + ";border-radius:999px;background:" + (ok ? "var(--green-soft)" : "var(--red-soft)") + ";color:" + (ok ? "#0f7a48" : "#b3263a") + ";font:750 " + (fs - 2) + "px/1 'Geist Mono'", head, esc(e.status));
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
    // Same-origin paths only: "//host" and "/\host" both leave the origin.
    if (!/^\/(?![\/\\])/.test(src)) return null;
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
  // The shapes the server's normalizer allows (src/server/explainer/shots.ts).
  var SHAPES = { path: 1, rect: 1, circle: 1, line: 1, polyline: 1, polygon: 1 };
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
      // Only drawing primitives: never a <script>, <foreignObject> or <a>.
      if (!own(SHAPES, s.shape)) return;
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
  // A moving end redraws its arrows in this many straight tweens.
  var REROUTE_STEPS = 10;
  function buildArrow(e, layer, items) {
    var a = items[e.from];
    var b = items[e.to];
    if (!a || !b) return null;
    // The rects the route was last drawn between, and that route.
    var ends = { a: rectOf(a), b: rectOf(b) };
    var pts = route(ends.a, ends.b);
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "wires");
    svg.setAttribute("data-id", e.id);
    svg.setAttribute("data-kind", "arrow");
    layer.insertBefore(svg, layer.firstChild);
    var p = document.createElementNS(NS, "path");
    p.setAttribute("d", pathOf(pts));
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
    function headAt(q) {
      var end = q[q.length - 1];
      var prev = q[q.length - 2];
      var ang = (Math.atan2(end[1] - prev[1], end[0] - prev[0]) * 180) / Math.PI;
      return "translate(" + end[0] + "," + end[1] + ") rotate(" + ang + ")";
    }
    var head = document.createElementNS(NS, "path");
    head.setAttribute("d", "M -14 -9 L 1 0 L -14 9 Z");
    head.setAttribute("fill", INK);
    head.setAttribute("transform", headAt(pts));
    head.style.opacity = 0;
    svg.appendChild(head);
    var nodes = [svg];
    var label = null;
    function labelAt(q) {
      var mid = q[Math.floor((q.length - 1) / 2)];
      var nxt = q[Math.floor((q.length - 1) / 2) + 1];
      return { left: (mid[0] + nxt[0]) / 2 - 130 + "px", top: (mid[1] + nxt[1]) / 2 - 17 + "px" };
    }
    if (e.label) {
      var at = labelAt(pts);
      label = h("div", "mono", "position:absolute;left:" + at.left + ";top:" + at.top + ";width:260px;text-align:center;font:600 18px/34px 'Geist Mono';color:var(--ink-2)", layer, '<span style="background:var(--paper);padding:3px 9px;border-radius:6px">' + esc(e.label) + "</span>");
      nodes.push(label);
    }
    // Packets ride in their own box, so an arrow that exits takes a packet
    // still running with it.
    var packets = h("div", "", "position:absolute;left:0;top:0", layer);
    nodes.push(packets);
    var home = pts[0];
    var packet = h("div", "", "position:absolute;left:" + (home[0] - 11) + "px;top:" + (home[1] - 11) + "px;width:22px;height:22px;border-radius:50%;background:#7a2be0;border:3px solid " + INK + ";opacity:0", packets);
    // The route's bounds (padded to the label's height), for actions that
    // frame or mark the arrow.
    function boxOf(q) {
      var xs = q.map(function (r) { return r[0]; });
      var ys = q.map(function (r) { return r[1]; });
      var x0 = Math.min.apply(null, xs) - 20;
      var y0 = Math.min.apply(null, ys) - 20;
      return { x: x0 / U, y: y0 / U, w: (Math.max.apply(null, xs) + 20 - x0) / U, h: (Math.max.apply(null, ys) + 20 - y0) / U };
    }
    // Packet runs scheduled so far, so a reroute can send later ones the new way.
    var trips = [];
    function flow(t, until) {
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
        for (var j = 1; j < pts.length; j++) keys.push({ x: pts[j][0] - home[0], y: pts[j][1] - home[1], duration: (trip * legs[j - 1]) / total, ease: "none" });
        trips.push({
          t0: t0,
          trip: trip,
          until: until,
          tweens: [
            tl.fromTo(packet, { x: pts[0][0] - home[0], y: pts[0][1] - home[1], opacity: 1 }, { keyframes: keys, immediateRender: false }, t0).recent(),
            tl.to(packet, { opacity: 0, duration: 0.1 }, t0 + trip).recent(),
          ],
        });
      }
    }
    return {
      el: svg,
      nodes: nodes,
      arrow: true,
      from: a,
      to: b,
      box: boxOf(pts),
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
      flow: flow,
      // An end moved (its pos is already the new one): redraw the route
      // between the ends as they travel, on the move's own clock, and send
      // packets not yet under way the new way. Returns the new bounds.
      reroute: function (t, d, ease) {
        var from = ends;
        var to = { a: rectOf(a), b: rectOf(b) };
        ends = to;
        pts = route(to.a, to.b);
        // The route between the ends where they are at each step of the
        // move's ease, joined by linear tweens. Only tweens, no callbacks: a
        // seek runs none, and the stage is driven by seeks.
        var curve = gsap.parseEase(ease);
        var steps = [];
        for (var i = 0; i <= REROUTE_STEPS; i++) {
          var k = curve(i / REROUTE_STEPS);
          var q = square(route(lerpRect(from.a, to.a, k), lerpRect(from.b, to.b, k)));
          steps.push({ d: pathOf(q), head: headAt(q), label: labelAt(q) });
        }
        var step = d / REROUTE_STEPS;
        for (var s = 0; s < REROUTE_STEPS; s++) {
          var was = steps[s];
          var now = steps[s + 1];
          var when = t + s * step;
          tl.fromTo(p, { attr: { d: was.d } }, { attr: { d: now.d }, duration: step, ease: "none", immediateRender: false }, when);
          tl.fromTo(head, { attr: { transform: was.head } }, { attr: { transform: now.head }, duration: step, ease: "none", immediateRender: false }, when);
          if (label) tl.fromTo(label, { left: was.label.left, top: was.label.top }, { left: now.label.left, top: now.label.top, duration: step, ease: "none", immediateRender: false }, when);
        }
        var until = null;
        var flying = false;
        trips = trips.filter(function (run) {
          if (run.t0 < t) {
            if (run.t0 + run.trip > t) flying = true;
            return true;
          }
          until = run.until;
          run.tweens.forEach(function (tw) { tl.remove(tw); });
          return false;
        });
        // A packet under way when the ends start moving leaves the old route.
        if (flying) tl.to(packet, { opacity: 0, duration: 0.1 }, t);
        if (until != null && until > t + d) flow(t + d, until);
        return boxOf(pts);
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
        // Arrows joined to it follow on the same tween, packets included.
        Object.keys(items).forEach(function (id) {
          var it = items[id];
          if (it.arrow && (it.built.from === first || it.built.to === first)) it.pos = it.built.reroute(t, 0.55, "power3.inOut");
        });
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
        tl.to(sc.cam, { scale: view.s, x: F.fx - view.s * view.cx, y: F.fy - view.s * view.cy, duration: 0.75, ease: "power3.inOut" }, t);
        sc.view = { s: view.s, x: F.fx - view.s * view.cx, y: F.fy - view.s * view.cy };
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
    var cam = h("div", "", "position:absolute;left:0;top:0;width:" + F.w + "px;height:" + F.h + "px;transform-origin:0 0", drift);
    sc.cam = cam;
    sc.items = dict();
    sc.view = { s: 1, x: 0, y: 0 };
    tl.set(sec, { visibility: "visible" }, sc.tIn);
    transitionIn(inner, sc.transition, sc.tIn);
    if (!RENDER) tl.fromTo(drift, { scale: 1 }, { scale: 1.015, duration: Math.max(0.5, sc.tOut - sc.tIn), ease: "none" }, sc.tIn);
    transitionOut(inner, (scenes[k + 1] && scenes[k + 1].transition) || "zoom", sc.tOut);
    tl.set(sec, { visibility: "hidden" }, sc.tOut);
    sound.scene(k);
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
      var spot = F.h > F.w ? { x: F.L / U, y: F.TOP / U + 0.4, w: (F.R - F.L) / U, h: Math.min(6, (F.BOT - F.TOP) / U - 0.8) } : { x: 1, y: 2.2, w: 14, h: 4.5 };
      var built = B.heading(Object.assign({ text: fallback }, spot), cam);
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
  var hair = h("div", "", "position:absolute;left:0;bottom:0;width:" + F.w + "px;height:6px;background:#7a2be0;transform-origin:left center", rail);
  tl.fromTo(hair, { scaleX: 0 }, { scaleX: 1, duration: DUR, ease: "none" }, 0);

  var end = h("section", "scene", "", stage);
  // A tall frame keeps the end card inside the area its captions leave free.
  var tall = F.h > F.w;
  var endPad = tall ? F.L + 20 : 150;
  var endW = F.w - 2 * endPad;
  var endInner = h("div", "inner", "display:flex;flex-direction:column;justify-content:center;padding:0 " + endPad + "px" + (tall ? ";top:" + F.TOP + "px;bottom:" + (F.h - F.BOT) + "px" : ""), end);
  var outro = S.outro || S.title;
  var os = fitSize(outro.replace(/\*/g, ""), function (s) { return "400 " + s + 'px "Instrument Serif"'; }, endW, tall ? 620 : 420, 1.02, tall ? 132 : 150, tall ? 52 : 60);
  var line = h("div", "serif", "font-size:" + os + "px;line-height:1.02;letter-spacing:-0.02em;max-width:" + endW + "px", endInner);
  var words = accentWords(outro).map(function (w) {
    var sp = h("span", "hw", "", line, w);
    line.appendChild(document.createTextNode(" "));
    return sp;
  });
  var sign = h("div", "", "margin-top:56px;display:flex;flex-wrap:wrap;align-items:center;gap:18px", endInner, GLYPH + '<span class="mono" style="font:600 28px/1 \'Geist Mono\'">github.com/' + esc(M.owner + "/" + M.repo) + '</span><span style="font:400 24px/1 Geist;color:var(--ink-2);margin-left:6px">· made with GitDiagram</span>');
  tl.set(end, { visibility: "visible" }, endAt);
  words.forEach(function (sp, k) { tl.fromTo(sp, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, endAt + 0.1 + k * 0.06); });
  riseIn(sign, endAt + 0.5, { y: 20, d: 0.5 });

  sound.mix();
  tl.to({}, { duration: 0.01 }, DUR - 0.01);
  window.__timelines.main = tl;
}
Promise.all(
  ['400 32px "Geist"', '400 32px "Geist Mono"', '400 32px "Instrument Serif"', 'italic 400 32px "Instrument Serif"'].map(function (f) {
    return document.fonts.load(f);
  }),
).then(build);
