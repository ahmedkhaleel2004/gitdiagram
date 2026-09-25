// @ts-check
// The shot engine's geometry: where items sit, how arrows route between
// them, and how the camera frames a beat or pushes in for a focus. Pure
// functions of the items' positions; the timeline stays in shots.js.
(function (kit) {
  var U = kit.U;

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
    var m = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    return [pts[0], m, m.slice(), pts[1]];
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

  kit.rectOf = rectOf;
  kit.route = route;
  kit.pathOf = pathOf;
  kit.lerpRect = lerpRect;
  kit.square = square;
  kit.focusView = focusView;
  kit.autoView = autoView;
})((/** @type {any} */ (window).ShotKit = /** @type {any} */ (window).ShotKit || {}));
