// @ts-check
// Reels: a film is designed for the wide 16 × 9 frame; this re-lays each
// scene out for a tall phone screen before the engine builds it. A scene's
// parts are cut into blocks the way the designer arranged them (columns and
// rows; overlapping parts stay together as they were drawn), and each cut
// may turn: a row of columns becomes a stack, a flow left to right runs top
// to bottom. Every way of turning the cuts is tried; the one that shows the
// scene biggest wins, with arrows that would cross other parts counted
// against it. Pure: takes a plan, returns a new one.
(function (kit) {
  var U = kit.U;
  // Text that re-wraps: a wide one becomes narrower and taller.
  var TEXTY = { heading: 1, text: 1, list: 1 };
  // More turnable cuts than this and only whole levels turn together.
  var MAX_SEARCH = 10;
  // The camera frames a scene up to this big (camera.js); past it, a bigger
  // fit shows nothing bigger.
  var MAX_ZOOM = 1.45;

  function num(v) {
    return Number(v) || 0;
  }
  function round(v) {
    return Math.round(v * 100) / 100;
  }
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function bboxOf(rects) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    rects.forEach(function (r) {
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w);
      y1 = Math.max(y1, r.y + r.h);
    });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function overlaps(a, b) {
    var pad = 0.02;
    return a.x < b.x + b.w - pad && b.x < a.x + a.w - pad && a.y < b.y + b.h - pad && b.y < a.y + a.h - pad;
  }

  // ---------- phases: a beat that clears the screen starts afresh ----------
  function phasesOf(beats) {
    var phases = [];
    var current = null;
    var live = kit.dict();
    beats.forEach(function (beat) {
      var gone = kit.dict();
      (beat.actions || []).forEach(function (a) {
        if (a.do === "exit") (a.target || []).forEach(function (id) { gone[id] = 1; });
      });
      var ids = Object.keys(live);
      var cleared = ids.length > 0 && ids.every(function (id) { return gone[id]; });
      if (!current || (cleared && beat.elements.length)) {
        current = { els: [], arrows: [] };
        phases.push(current);
      }
      ids.forEach(function (id) { if (gone[id]) delete live[id]; });
      beat.elements.forEach(function (e) {
        if (e.kind === "arrow") current.arrows.push(e);
        else {
          current.els.push(e);
          live[e.id] = 1;
        }
      });
      (beat.actions || []).forEach(function (a) {
        if (a.do === "restore") (a.target || []).forEach(function (id) { live[id] = 1; });
      });
    });
    return phases;
  }

  // ---------- blocks: parts drawn over each other stay together ----------
  function blocksOf(els) {
    var parent = els.map(function (_, i) { return i; });
    function find(i) {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]];
      return i;
    }
    for (var i = 0; i < els.length; i++)
      for (var j = i + 1; j < els.length; j++) if (overlaps(els[i].r, els[j].r)) parent[find(i)] = find(j);
    var groups = kit.dict();
    els.forEach(function (e, k) { (groups[find(k)] = groups[find(k)] || []).push(e); });
    return Object.keys(groups).map(function (k) { return block(groups[k]); });
  }
  function block(els) {
    return { els: els, box: bboxOf(els.map(function (e) { return e.r; })) };
  }

  // A block no wider than the screen: wide text re-wraps narrower and taller;
  // anything else shrinks whole. Sets where each part sits inside it.
  function settle(b, maxW) {
    var box = b.box;
    b.scale = 1;
    b.w = box.w;
    b.h = box.h;
    b.local = b.els.map(function (e) {
      return { e: e, x: e.r.x - box.x, y: e.r.y - box.y, w: e.r.w, h: e.r.h };
    });
    if (box.w <= maxW) return;
    if (b.els.length === 1 && TEXTY[b.els[0].kind]) {
      var tall = Math.min(box.h * 3, (box.h * box.w) / maxW);
      b.local[0].w = b.w = maxW;
      b.local[0].h = b.h = Math.max(box.h, tall);
      return;
    }
    var k = maxW / box.w;
    b.scale = k;
    b.w = box.w * k;
    b.h = box.h * k;
    b.local.forEach(function (p) {
      p.x *= k;
      p.y *= k;
      p.w *= k;
      p.h *= k;
    });
  }

  // ---------- the cut tree ----------
  // Blocks split into groups along one axis wherever nothing spans the gap.
  // `slack` lets a part reach a little past the gap (a chip overhanging the
  // next column) without holding the two together.
  function split(blocks, axis, slack) {
    var lo = axis === "x" ? "x" : "y";
    var len = axis === "x" ? "w" : "h";
    var sorted = blocks.slice().sort(function (a, b) { return a.box[lo] - b.box[lo]; });
    var groups = [[sorted[0]]];
    var gaps = [];
    var end = sorted[0].box[lo] + sorted[0].box[len];
    for (var i = 1; i < sorted.length; i++) {
      var b = sorted[i];
      if (b.box[lo] >= end - slack) {
        gaps.push(Math.max(0, b.box[lo] - end));
        groups.push([b]);
      } else groups[groups.length - 1].push(b);
      end = Math.max(end, b.box[lo] + b.box[len]);
    }
    return groups.length > 1 ? { groups: groups, gaps: gaps } : null;
  }
  // Where a scene divides both ways, which way it divides first is a guess:
  // "gap" takes the wider gap (the designer's main division), "x" and "y"
  // always take columns or rows. Every guess is laid out; the best one wins.
  var PREFER = ["gap", "x", "y"];
  function cut(blocks, prefer) {
    if (blocks.length === 1) return { leaf: blocks[0], box: blocks[0].box };
    var byX = split(blocks, "x", 0.01);
    var byY = split(blocks, "y", 0.01);
    if (!byX && !byY) {
      byX = split(blocks, "x", 0.6);
      byY = split(blocks, "y", 0.6);
    }
    var widest = function (s) { return s ? Math.max.apply(null, s.gaps) : -1; };
    var columns = byX && (!byY || prefer === "x" || (prefer === "gap" && widest(byX) >= widest(byY) - 0.05));
    var pick = columns ? { dir: "row", s: byX } : byY ? { dir: "col", s: byY } : null;
    // Interlocked blocks with no clean cut stay as drawn.
    if (!pick) {
      var all = block([].concat.apply([], blocks.map(function (b) { return b.els; })));
      return { leaf: all, box: all.box, merged: blocks };
    }
    var kids = pick.s.groups.map(function (g) { return cut(g, prefer); });
    return { dir: pick.dir, kids: kids, gaps: pick.s.gaps, box: bboxOf(kids.map(function (k) { return k.box; })) };
  }
  function nodesOf(node, depth, out) {
    if (node.leaf) return out;
    node.depth = depth;
    out.push(node);
    node.kids.forEach(function (k) { nodesOf(k, depth + 1, out); });
    return out;
  }

  // Lays a node out with its cut turned or not; returns its size and where
  // each block sits inside it.
  function layout(node, turned) {
    if (node.leaf) return { w: node.leaf.w, h: node.leaf.h, at: [{ leaf: node.leaf, x: 0, y: 0 }] };
    var turn = turned(node);
    var dir = turn ? (node.dir === "row" ? "col" : "row") : node.dir;
    var kids = node.kids.map(function (k) { return layout(k, turned); });
    var main = dir === "row" ? "x" : "y";
    var cross = dir === "row" ? "y" : "x";
    var mainLen = dir === "row" ? "w" : "h";
    var crossLen = dir === "row" ? "h" : "w";
    // Turned, the parts line up centred with room for an arrow and its label
    // between them;
    // as drawn, they keep the designer's spacing and alignment.
    var span = Math.max.apply(null, kids.map(function (k) { return k[crossLen]; }));
    var at = [];
    var cursor = 0;
    var lowest = Infinity;
    kids.forEach(function (k, i) {
      if (i) cursor += turn ? clamp(node.gaps[i - 1], 0.8, 1.1) : clamp(node.gaps[i - 1], 0.3, 1.4);
      var offset;
      if (turn) offset = (span - k[crossLen]) / 2;
      else {
        var kb = node.kids[i].box;
        var centre = kb[cross] + kb[crossLen] / 2 - node.box[cross];
        offset = centre - k[crossLen] / 2;
      }
      lowest = Math.min(lowest, offset);
      k.at.forEach(function (p) {
        var q = { leaf: p.leaf, x: p.x, y: p.y };
        q[main] += cursor;
        q[cross] += offset;
        at.push(q);
      });
      cursor += k[mainLen];
    });
    at.forEach(function (p) { p[cross] -= lowest; });
    var size = bboxOf(at.map(function (p) { return { x: p.x, y: p.y, w: p.leaf.w, h: p.leaf.h }; }));
    return { w: size.w, h: size.h, at: at };
  }

  // Where each part lands, in canvas units, for one arrangement.
  function place(result) {
    var spots = kit.dict();
    result.at.forEach(function (p) {
      p.leaf.local.forEach(function (l) {
        spots[l.e.id] = { x: p.x + l.x, y: p.y + l.y, w: l.w, h: l.h };
      });
    });
    return spots;
  }

  // Arrows between blocks that would run through another part.
  function crossings(arrows, spots, ids) {
    var hits = 0;
    arrows.forEach(function (a) {
      var from = spots[a.from];
      var to = spots[a.to];
      if (!from || !to) return;
      var px = function (r) { return { x: r.x * U, y: r.y * U, w: r.w * U, h: r.h * U }; };
      var pts = kit.route(px(from), px(to));
      ids.forEach(function (id) {
        if (id === a.from || id === a.to) return;
        var r = px(spots[id]);
        for (var i = 1; i < pts.length; i++) {
          var x0 = Math.min(pts[i - 1][0], pts[i][0]), x1 = Math.max(pts[i - 1][0], pts[i][0]);
          var y0 = Math.min(pts[i - 1][1], pts[i][1]), y1 = Math.max(pts[i - 1][1], pts[i][1]);
          if (x1 > r.x + 8 && x0 < r.x + r.w - 8 && y1 > r.y + 8 && y0 < r.y + r.h - 8) {
            hits++;
            return;
          }
        }
      });
    });
    return hits;
  }

  // Every way of turning the cuts (or, past MAX_SEARCH cuts, every depth
  // below which they turn), as a test of which ones turn.
  function choices(nodes) {
    var out = [];
    if (nodes.length <= MAX_SEARCH) {
      for (var mask = 0; mask < 1 << nodes.length; mask++)
        out.push((function (m) {
          return function (node) { return Boolean(m & (1 << nodes.indexOf(node))); };
        })(mask));
      return out;
    }
    var deepest = Math.max.apply(null, nodes.map(function (n) { return n.depth; }));
    for (var d = 0; d <= deepest + 1; d++)
      out.push((function (limit) {
        return function (node) { return node.depth < limit; };
      })(d));
    return out;
  }

  function arrangePhase(phase, room) {
    if (!phase.els.length) return;
    var maxW = room.w;
    var els = phase.els.map(function (e) {
      return { e: e, id: e.id, kind: e.kind, r: { x: num(e.x), y: num(e.y), w: Math.max(0.1, num(e.w)), h: Math.max(0.1, num(e.h)) } };
    });
    var blocks = blocksOf(els);
    blocks.forEach(function (b) { settle(b, maxW); });
    var ids = els.map(function (e) { return e.id; });
    var best = null;
    PREFER.forEach(function (prefer) {
      var tree = cut(blocks, prefer);
      // Blocks merged for having no clean cut are laid out as one.
      (function collect(node) {
        if (node.merged) settle(node.leaf, maxW);
        else if (!node.leaf) node.kids.forEach(collect);
      })(tree);
      var nodes = nodesOf(tree, 0, []);
      choices(nodes).forEach(function (turned) {
        var result = layout(tree, turned);
        var turns = nodes.filter(turned).length;
        var fit = Math.min(MAX_ZOOM, room.w / result.w, room.h / result.h);
        var spots = place(result);
        var score = fit - 0.12 * crossings(phase.arrows, spots, ids) - 0.015 * turns;
        if (!best || score > best.score + 1e-9) best = { score: score, result: result, spots: spots };
      });
    });
    var result = best.result;
    // Centred in the room; one bigger than it is framed by the camera.
    var ox = room.x + (room.w - result.w) / 2;
    var oy = room.y + (room.h - result.h) / 2;
    els.forEach(function (it) {
      var s = best.spots[it.id];
      it.e.x = round(ox + s.x);
      it.e.y = round(oy + s.y);
      it.e.w = round(s.w);
      it.e.h = round(s.h);
    });
    // How a point in the old frame maps into its block's new place.
    phase.maps = result.at.map(function (p) {
      return { from: p.leaf.box, scale: p.leaf.scale, x: ox + p.x, y: oy + p.y, ids: p.leaf.els.map(function (e) { return e.id; }) };
    });
  }

  // A move keeps its meaning: to a spot inside its own block, it goes to the
  // same spot there; to somewhere else, to that spot in the block it lands on.
  function remapMove(a, el, before, phase) {
    if (!phase || !phase.maps) return;
    var tx = num(a.x) + before.w / 2;
    var ty = num(a.y) + before.h / 2;
    var own = phase.maps.filter(function (m) { return m.ids.indexOf(el.id) >= 0; })[0];
    var near = function (m) {
      var b = m.from;
      var dx = Math.max(b.x - tx, 0, tx - (b.x + b.w));
      var dy = Math.max(b.y - ty, 0, ty - (b.y + b.h));
      return Math.hypot(dx, dy);
    };
    var map = own && near(own) <= 1.5 ? own : phase.maps.slice().sort(function (p, q) { return near(p) - near(q); })[0];
    a.x = round(map.x + (num(a.x) - map.from.x) * map.scale);
    a.y = round(map.y + (num(a.y) - map.from.y) * map.scale);
  }

  /**
   * The plan re-laid for a tall frame. `room` is the free area in canvas
   * units ({ x, y, w, h }), clear of the captions and the page's buttons.
   */
  kit.reflow = function (spec, room) {
    var plan = JSON.parse(JSON.stringify(spec));
    var scenes = [];
    plan.beats.forEach(function (b) {
      var last = scenes[scenes.length - 1];
      if (last && last.id === b.scene) last.beats.push(b);
      else scenes.push({ id: b.scene, beats: [b] });
    });
    scenes.forEach(function (sc) {
      // Where each part started, before the layout moved it.
      var before = kit.dict();
      sc.beats.forEach(function (b) {
        b.elements.forEach(function (e) { before[e.id] = { w: num(e.w), h: num(e.h) }; });
      });
      var phases = phasesOf(sc.beats);
      phases.forEach(function (p) { arrangePhase(p, room); });
      var phaseOf = kit.dict();
      var byId = kit.dict();
      phases.forEach(function (p) {
        p.els.forEach(function (e) {
          phaseOf[e.id] = p;
          byId[e.id] = e;
        });
      });
      sc.beats.forEach(function (b) {
        (b.actions || []).forEach(function (a) {
          if (a.do !== "move") return;
          var id = (a.target || [])[0];
          if (byId[id]) remapMove(a, byId[id], before[id], phaseOf[id]);
        });
      });
    });
    return plan;
  };
})((/** @type {any} */ (window).ShotKit = /** @type {any} */ (window).ShotKit || {}));
