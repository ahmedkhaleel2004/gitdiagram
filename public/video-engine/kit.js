// @ts-check
// Shared helpers for the shot engine (shots.js): escaping, DOM, text
// measuring and fitting, syntax tint, icons and tones. Stateless: every
// build draws with the same kit. Loaded by stage.html before stage.js.
(function (kit) {
  // The canvas unit (16 × 9 of them fill the 1920 × 1080 frame) and the ink.
  var U = 120;
  var INK = "#17111f";

  // Model-written ids and names index tables, and "constructor" is a fine id:
  // no lookup may reach a prototype.
  function dict() {
    return Object.create(null);
  }
  function own(table, key) {
    return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
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
  // Numbers as the film shows them: 1,234 and 1.25.
  function fmt(v) {
    return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  kit.U = U;
  kit.INK = INK;
  kit.dict = dict;
  kit.own = own;
  kit.esc = esc;
  kit.h = h;
  kit.textW = textW;
  kit.fitSize = fitSize;
  kit.fitText = fitText;
  kit.monoFit = monoFit;
  kit.accentHtml = accentHtml;
  kit.accentWords = accentWords;
  kit.tint = tint;
  kit.icon = icon;
  kit.CHECK = CHECK;
  kit.CROSS = CROSS;
  kit.GLYPH = GLYPH;
  kit.TONE_BG = TONE_BG;
  kit.TONE_INK = TONE_INK;
  kit.PAINT = PAINT;
  kit.toneOf = toneOf;
  kit.norm = norm;
  kit.fmt = fmt;
})((/** @type {any} */ (window).ShotKit = /** @type {any} */ (window).ShotKit || {}));
