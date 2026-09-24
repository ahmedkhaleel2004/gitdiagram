// The stage. In the live player the parent page owns audio and the clock; this
// frame only builds the scene timeline from the plan it is sent and seeks it on
// request. The MP4 renderer drives the same stage frame by frame.
(function () {
  window.__timelines = {};
  var timeline = null;
  var failed = false;
  // The frame URL carries the engine version so a deploy never meets a stale engine.
  var version = new URLSearchParams(window.location.search).get("v") || "0";
  var captions = null;

  function post(message) {
    window.parent.postMessage(message, window.location.origin);
  }

  function fail(message) {
    if (failed || timeline) return;
    failed = true;
    post({ type: "error", message: String(message || "Stage error").slice(0, 300) });
  }

  function el(tag, id, parent, text) {
    var node = document.createElement(tag);
    if (id) node.id = id;
    if (text != null) node.textContent = text;
    (parent || document.body).appendChild(node);
    return node;
  }

  var GLYPH =
    '<svg width="100%" height="100%" viewBox="0 0 46 46" fill="none" stroke="#17111f" stroke-width="3.5"><rect x="3" y="3" width="16" height="16" rx="3" fill="#bd85fb"/><rect x="27" y="3" width="16" height="16" rx="3" fill="#fdfaff"/><rect x="15" y="27" width="16" height="16" rx="3" fill="#dcc2ff"/><path d="M19 11 H27 M35 19 V23 H23 V27"/></svg>';

  // ---------- captions: the current beat's words, lit as they are spoken ----------
  function setupCaptions(host) {
    captions = { box: el("div", "captions", host), beat: -1, words: [], on: true };
  }

  function updateCaptions(t) {
    if (!captions) return;
    var beats = window.TIMING.beats;
    var index = -1;
    for (var i = 0; i < beats.length; i++) {
      if (t >= beats[i].start - 0.12 && t <= beats[i].end + 0.35) {
        index = i;
        break;
      }
    }
    if (!captions.on || index < 0) {
      captions.box.style.opacity = "0";
      return;
    }
    if (index !== captions.beat) {
      captions.beat = index;
      captions.box.textContent = "";
      var text = String((window.SPEC.beats[index] || {}).narration || "");
      captions.words = text.split(/\s+/).filter(Boolean).map(function (word, k) {
        if (k) captions.box.appendChild(document.createTextNode(" "));
        return el("span", "", captions.box, word);
      });
    }
    // Timing words line up with the narration's whitespace-separated words.
    var timed = beats[index].words;
    captions.words.forEach(function (span, k) {
      var spoken = timed[k] ? timed[k].s <= t : t >= beats[index].end;
      span.className = spoken ? "on" : "";
    });
    captions.box.style.opacity = "1";
  }

  // ---------- vertical (9:16) frame for Shorts, Reels and TikTok ----------
  function setupVertical() {
    document.documentElement.classList.add("vertical");
    var meta = window.META || {};
    var top = el("div", "vtop");
    var repo = el("div", "vrepo", top);
    el("span", "vglyph", repo).innerHTML = GLYPH;
    el("span", "", repo, (meta.owner || "") + "/" + (meta.repo || ""));
    var title = el("div", "vtitle", top, String((window.SPEC || {}).title || meta.repo || ""));
    // Largest size at which the title fits on one line; ellipsis only as a last resort.
    for (var size = 124; size > 64 && title.scrollWidth > title.clientWidth; size -= 4) title.style.fontSize = size + "px";
    el("div", "vsub", top, "explained in about a minute");
    var captionHost = el("div", "vcaptions");
    el("div", "vfoot", null, "gitdiagram.com/" + (meta.owner || "") + "/" + (meta.repo || ""));
    return captionHost;
  }

  // ---------- poster: a still with a play button, for link previews ----------
  function showPoster() {
    var overlay = el("div", "poster", document.getElementById("root"));
    var button = el("div", "poster-play", overlay);
    button.innerHTML = '<svg viewBox="0 0 24 24" width="92" height="92"><path d="M8 5.5v13l11-6.5z" fill="#17111f"/></svg>';
    el("div", "poster-tag", overlay, "Watch the one-minute video");
  }

  // ---------- live player: scale the stage to the frame ----------
  // Offline renders open the stage at 1920×1080 on its own; the player frames
  // it at whatever size the page shows it. WebKit gives every GPU layer a
  // full-size 1920×1080 buffer whatever the scale, so the stage keeps to 2D
  // transforms and paints into one frame-sized surface instead: 3D ones cost
  // an iPhone over half a gigabyte, and zooming the page crashed the tab.
  function fitToFrame() {
    if (window.parent === window) return;
    var root = document.documentElement;
    root.classList.add("fit");
    gsap.config({ force3D: false });
    var fit = function () {
      root.style.setProperty("--fit", String(window.innerWidth / 1920));
    };
    fit();
    window.addEventListener("resize", fit);
  }

  function seek(time) {
    var t = Math.max(0, Math.min(Number(time) || 0, timeline.duration()));
    timeline.seek(t);
    updateCaptions(t);
  }

  function waitForTimeline(options) {
    if (failed) return;
    var built = window.__timelines.main;
    if (!built) {
      setTimeout(function () {
        waitForTimeline(options);
      }, 30);
      return;
    }
    timeline = built;
    var captionHost = options.layout === "vertical" ? setupVertical() : document.getElementById("root");
    setupCaptions(captionHost);
    captions.on = options.captions;
    if (options.poster) showPoster();
    seek(0);
    // The renderer seeks directly, frame by frame, without a message round trip.
    window.__renderSeek = seek;
    post({ type: "ready", duration: timeline.duration(), sfx: window.__SFX || [] });
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    var message = event.data || {};
    if (message.type === "load" && !window.SPEC) {
      window.SPEC = message.spec;
      window.META = message.meta;
      window.TIMING = message.timing;
      var engine = document.createElement("script");
      engine.src = "shots.js?v=" + encodeURIComponent(version);
      engine.onerror = function () {
        fail("The scene engine failed to load.");
      };
      document.body.appendChild(engine);
      // Offline renders (MP4s, posters) run in software on machines without a
      // GPU: skip the full-frame noise layer, which would re-blend every frame
      // and is invisible after video compression anyway.
      if (message.render) document.documentElement.classList.add("render");
      waitForTimeline({
        captions: Boolean(message.captions),
        layout: message.layout === "vertical" ? "vertical" : "landscape",
        poster: Boolean(message.poster),
      });
    } else if (message.type === "seek" && timeline) {
      seek(message.time);
    } else if (message.type === "captions" && captions) {
      captions.on = Boolean(message.on);
      if (timeline) updateCaptions(timeline.time());
    }
  });

  // Engines build inside a font-loading promise, so a bad plan surfaces as a
  // rejected promise, not an error event; report both.
  window.addEventListener("error", function (event) {
    fail(event.message);
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    fail(reason && reason.message ? reason.message : reason);
  });

  fitToFrame();
  post({ type: "stage-ready" });
})();
