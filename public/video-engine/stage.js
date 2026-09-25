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
  // A captions toggle that arrives before the timeline is built waits here.
  var captionsWanted = null;

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

  // The GitDiagram mark (the favicon: a document holding a small flowchart).
  var GLYPH =
    '<svg width="100%" height="100%" viewBox="94 94 832 832" aria-hidden="true"><g transform="translate(0.000000,1024.000000) scale(0.100000,-0.100000)" fill="#9333ea"><path d="M3860 9210 l-1215 -5 -70 -27 c-205 -78 -355 -207 -439 -378 -15 -30 -31 -62 -36 -71 -5 -9 -18 -56 -29 -104 l-21 -87 0 -3418 0 -3418 21 -87 c11 -48 24 -95 29 -104 5 -9 21 -41 36 -71 85 -173 241 -306 444 -378 l75 -27 2465 0 2465 0 75 27 c203 72 359 205 444 378 15 30 31 62 36 71 5 9 18 56 29 104 21 86 21 98 21 2300 0 1445 -3 2216 -10 2220 -5 3 -504 6 -1107 5 -1178 0 -1313 4 -1429 44 -239 84 -407 258 -496 516 l-22 65 -6 1219 c-5 1208 -5 1219 -25 1225 -11 3 -567 4 -1235 1z m518 -2560 c121 -16 202 -90 223 -205 6 -34 9 -263 7 -597 -3 -497 -4 -546 -21 -575 -31 -57 -80 -105 -132 -129 -45 -21 -65 -24 -190 -24 -77 0 -146 -4 -153 -9 -11 -7 -14 -93 -13 -452 0 -244 1 -448 1 -453 0 -19 585 -598 615 -610 22 -8 154 -10 470 -6 l440 5 5 155 c5 142 7 159 31 205 27 52 101 118 148 130 44 13 1023 18 1116 6 63 -8 94 -17 125 -37 56 -37 98 -102 111 -169 6 -34 9 -258 7 -597 -3 -497 -4 -546 -21 -575 -31 -57 -80 -105 -132 -129 l-50 -24 -565 0 -565 0 -50 24 c-28 12 -65 39 -82 60 -61 69 -66 87 -72 261 l-6 160 -455 3 -454 2 -361 -359 c-396 -396 -402 -401 -515 -401 -114 0 -115 2 -553 438 -219 218 -409 413 -423 433 -52 75 -60 159 -24 255 6 16 175 194 376 395 200 201 364 369 364 375 0 5 1 209 1 453 1 359 -2 445 -13 452 -7 5 -76 9 -153 9 -125 0 -145 3 -190 24 -52 24 -101 72 -132 129 -17 29 -18 78 -21 581 -2 354 1 567 7 598 24 108 105 183 214 197 88 12 997 12 1085 1z M5635 9038 c-3 -13 -4 -511 -3 -1108 l3 -1085 22 -41 c31 -58 90 -111 143 -129 39 -13 198 -15 1135 -16 1011 0 1090 1 1093 16 3 11 -391 412 -1181 1201 -651 651 -1189 1184 -1195 1184 -7 0 -14 -10 -17 -22z"/></g></svg>';

  // ---------- captions: the current beat's words, lit as they are spoken ----------
  function setupCaptions(host) {
    captions = { box: el("div", "captions", host), beat: -1, words: [], lit: [], on: true, shown: null };
  }

  // The latest beat that has started holds the caption, a little past its end
  // (a pause keeps the line up), until the next one starts.
  function captionBeat(t) {
    var beats = window.TIMING.beats;
    for (var i = beats.length - 1; i >= 0; i--) {
      if (t >= beats[i].start - 0.12) return t <= beats[i].end + 0.35 ? i : -1;
    }
    return -1;
  }

  // Runs every frame: the DOM is only written when something changed.
  function showCaptions(shown) {
    if (captions.shown === shown) return;
    captions.shown = shown;
    captions.box.style.opacity = shown ? "1" : "0";
  }

  function updateCaptions(t) {
    if (!captions) return;
    var index = captionBeat(t);
    if (!captions.on || index < 0) {
      showCaptions(false);
      return;
    }
    var beat = window.TIMING.beats[index];
    if (index !== captions.beat) {
      captions.beat = index;
      captions.box.textContent = "";
      var text = String((window.SPEC.beats[index] || {}).narration || "");
      captions.words = text.split(/\s+/).filter(Boolean).map(function (word, k) {
        if (k) captions.box.appendChild(document.createTextNode(" "));
        return el("span", "", captions.box, word);
      });
      captions.lit = captions.words.map(function () {
        return false;
      });
    }
    // Timing words line up with the narration's whitespace-separated words.
    var timed = beat.words;
    captions.words.forEach(function (span, k) {
      var spoken = timed[k] ? timed[k].s <= t : t >= beat.end;
      if (captions.lit[k] === spoken) return;
      captions.lit[k] = spoken;
      span.className = spoken ? "on" : "";
    });
    showCaptions(true);
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
    captions.on = captionsWanted === null ? options.captions : captionsWanted;
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
    } else if (message.type === "captions") {
      captionsWanted = Boolean(message.on);
      if (!captions) return;
      captions.on = captionsWanted;
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
