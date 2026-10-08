// @ts-check
// The shot engine's geometry: where items sit, how arrows route between
// them, and how the camera frames a beat or pushes in for a focus. Pure
// functions of the items' positions; the timeline stays in shots.js.
(function (kit) {
  var U = kit.U;

  function rectOf(item) {
    return { x: item.pos.x * U, y: item.pos.y * U, w: item.pos.w * U, h: item.pos.h * U };
  }
  // The plain route between two rects: out of the side that faces the other,
  // straight when they line up, one dog-leg when they do not.
  function direct(a, b, sideways) {
    var ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    var bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    if (sideways) {
      var right = bc.x >= ac.x;
      var x1 = right ? a.x + a.w + 6 : a.x - 6;
      var x2 = right ? b.x - 10 : b.x + b.w + 10;
      var mx = (x1 + x2) / 2;
      // Nearly level: one straight line both ends can take beats a small kink.
      var ly = level(ac.y, bc.y, a.y, a.h, b.y, b.h);
      if (ly != null) return [[x1, ly], [x2, ly]];
      return [[x1, ac.y], [mx, ac.y], [mx, bc.y], [x2, bc.y]];
    }
    var down = bc.y >= ac.y;
    var y1 = down ? a.y + a.h + 6 : a.y - 6;
    var y2 = down ? b.y - 10 : b.y + b.h + 10;
    var my = (y1 + y2) / 2;
    var lx = level(ac.x, bc.x, a.x, a.w, b.x, b.w);
    if (lx != null) return [[lx, y1], [lx, y2]];
    return [[ac.x, y1], [ac.x, my], [bc.x, my], [bc.x, y2]];
  }
  // Where a straight line can join two ends whose centres are nearly in
  // line: between the centres, inside the middle of both. Null when the
  // ends are too far out of line for that.
  function level(c1, c2, s1, len1, s2, len2) {
    if (Math.abs(c1 - c2) < 4) return c1;
    if (Math.abs(c1 - c2) > 0.3 * Math.min(len1, len2)) return null;
    var lo = Math.max(s1 + len1 * 0.2, s2 + len2 * 0.2);
    var hi = Math.min(s1 + len1 * 0.8, s2 + len2 * 0.8);
    if (lo > hi) return null;
    return Math.max(lo, Math.min(hi, (c1 + c2) / 2));
  }
  // One corner: out of a's side, into b's top or bottom (or the other way round).
  function corner(a, b, sideFirst) {
    var ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    var bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    if (sideFirst) {
      var right = bc.x >= ac.x;
      var down = bc.y >= ac.y;
      return [[right ? a.x + a.w + 6 : a.x - 6, ac.y], [bc.x, ac.y], [bc.x, down ? b.y - 10 : b.y + b.h + 10]];
    }
    var below = bc.y >= ac.y;
    var east = bc.x >= ac.x;
    return [[ac.x, below ? a.y + a.h + 6 : a.y - 6], [ac.x, bc.y], [east ? b.x - 10 : b.x + b.w + 10, bc.y]];
  }
  function crosses(p, q, r, pad) {
    var x0 = Math.min(p[0], q[0]), x1 = Math.max(p[0], q[0]);
    var y0 = Math.min(p[1], q[1]), y1 = Math.max(p[1], q[1]);
    return x1 > r.x + pad && x0 < r.x + r.w - pad && y1 > r.y + pad && y0 < r.y + r.h - pad;
  }
  // How bad a route is: every card it runs through counts far more than its
  // length, and a corner a little more than none.
  function cost(pts, a, b, obstacles) {
    var hits = 0;
    var length = 0;
    for (var i = 1; i < pts.length; i++) {
      var p = pts[i - 1], q = pts[i];
      length += Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]);
      for (var k = 0; k < obstacles.length; k++) if (crosses(p, q, obstacles[k], 2)) hits++;
      // Doubling back through one of its own ends.
      if (crosses(p, q, a, 8) || crosses(p, q, b, 12)) hits++;
    }
    // A corner cut too close to an end leaves a stub too short to read.
    var last = pts.length - 1;
    var stub = Math.min(
      Math.abs(pts[1][0] - pts[0][0]) + Math.abs(pts[1][1] - pts[0][1]),
      Math.abs(pts[last][0] - pts[last - 1][0]) + Math.abs(pts[last][1] - pts[last - 1][1]),
    );
    return hits * 10000 + length + (pts.length - 2) * 70 + (stub < 26 ? 4000 : 0);
  }
  // The route an arrow takes. With the scene's other cards given, the plain
  // route gives way to one that runs through none of them.
  function route(a, b, obstacles) {
    var gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
    var gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
    var plain = direct(a, b, gapX >= gapY);
    if (!obstacles) return plain;
    var best = plain;
    var bestCost = cost(plain, a, b, obstacles);
    if (bestCost < 4000) return plain;
    var others = [];
    if (gapX > 16 && gapY > 16) others.push(corner(a, b, true), corner(a, b, false));
    if (Math.min(gapX, gapY) > 16) others.push(direct(a, b, gapX < gapY));
    others.forEach(function (pts) {
      var c = cost(pts, a, b, obstacles);
      if (c < bestCost - 1) {
        best = pts;
        bestCost = c;
      }
    });
    return best;
  }
  function pathOf(pts) {
    return "M" + pts.map(function (q) { return q[0].toFixed(1) + "," + q[1].toFixed(1); }).join(" L");
  }
  function lerpRect(a, b, k) {
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k };
  }
  // A route as four points (a straight one gets two in its middle), so any
  // two routes tween point for point. It draws the same line.
  function square(pts) {
    if (pts.length === 4) return pts;
    if (pts.length === 3) return [pts[0], pts[1], pts[1].slice(), pts[2]];
    var m = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    return [pts[0], m, m.slice(), pts[1]];
  }
  // The frame the camera works in: its size, the area the label and captions
  // leave free, the point a focus centres on and the part of the frame where
  // a card counts as in view. Reels set a tall one (stage.js).
  kit.frame = {
    w: 1920,
    h: 1080,
    L: 110,
    R: 1810,
    TOP: 125,
    BOT: 895,
    fx: 960,
    fy: 540,
    fw: 1920 * 0.68,
    fh: 1080 * 0.68,
    view: { x0: 0, y0: 0, x1: 1920, y1: 1080 },
    minScale: 1,
  };
  // Where the camera pushes in for a focus. Nothing else on screen may end up
  // half in frame (that reads as a glitch): the view shifts to push it fully
  // out while keeping the targets in, or takes it in too. A push-in that would
  // barely zoom is skipped.
  function focusView(targets, sc) {
    var F = kit.frame;
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
      var s = Math.min(1.7, Math.min(F.fw / (box.x1 - box.x0), F.fh / (box.y1 - box.y0)));
      if (s < F.minScale * 1.08) return null;
      // How far the view reaches either side of the point it centres on.
      var left = (F.fx - F.view.x0) / s, right = (F.view.x1 - F.fx) / s;
      var up = (F.fy - F.view.y0) / s, down = (F.view.y1 - F.fy) / s;
      var cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
      var cut = null;
      for (var k = 0; k < others.length && !cut; k++) {
        var q = rectOf(others[k]);
        var ix = Math.max(0, Math.min(q.x + q.w, cx + right) - Math.max(q.x, cx - left));
        var iy = Math.max(0, Math.min(q.y + q.h, cy + down) - Math.max(q.y, cy - up));
        var frac = (ix * iy) / Math.max(1, q.w * q.h);
        if (frac > 0.01 && frac < 0.97) cut = q;
      }
      if (!cut) return { s: s, cx: cx, cy: cy };
      // Push it fully out along one axis if the targets still fit.
      var shifted = false;
      if (cut.x >= box.x1 && cut.x - 16 - left - right >= box.x0 - 60) { cx = cut.x - 16 - right; shifted = true; }
      else if (cut.x + cut.w <= box.x0 && cut.x + cut.w + 16 + left + right <= box.x1 + 60) { cx = cut.x + cut.w + 16 + left; shifted = true; }
      else if (cut.y >= box.y1 && cut.y - 16 - up - down >= box.y0 - 40) { cy = cut.y - 16 - down; shifted = true; }
      else if (cut.y + cut.h <= box.y0 && cut.y + cut.h + 16 + up + down <= box.y1 + 40) { cy = cut.y + cut.h + 16 + up; shifted = true; }
      if (shifted) {
        var clean = others.every(function (it) {
          var r = rectOf(it);
          var jx = Math.max(0, Math.min(r.x + r.w, cx + right) - Math.max(r.x, cx - left));
          var jy = Math.max(0, Math.min(r.y + r.h, cy + down) - Math.max(r.y, cy - up));
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
    var F = kit.frame;
    var L = F.L, R = F.R, TOP = F.TOP, BOT = F.BOT;
    var s = Math.max(F.minScale, Math.min(AUTO_MAX, (R - L) / (box.x1 - box.x0 + 70), (BOT - TOP) / (box.y1 - box.y0 + 70)));
    var x = (L + R) / 2 - s * (box.x0 + box.x1) / 2;
    var y = (TOP + BOT) / 2 - s * (box.y0 + box.y1) / 2;
    // Content bigger than the safe area is never pushed further out of it
    // than the designer placed it (under the label or the captions).
    x = Math.max(Math.min(x, Math.max(box.x1, R) - s * box.x1), Math.min(box.x0, L) - s * box.x0);
    y = Math.max(Math.min(y, Math.max(box.y1, BOT) - s * box.y1), Math.min(box.y0, TOP) - s * box.y0);
    return { s: s, x: x, y: y };
  }

  kit.rectOf = rectOf;
  kit.route = route;
  kit.pathOf = pathOf;
  kit.lerpRect = lerpRect;
  kit.square = square;
  kit.focusView = focusView;
  kit.autoView = autoView;
})((/** @type {any} */ (window).ShotKit = /** @type {any} */ (window).ShotKit || {}));
