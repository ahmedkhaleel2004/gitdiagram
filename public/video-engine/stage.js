// The live player's stage. The parent page owns audio and the clock; this frame
// only builds the scene timeline from the plan it is sent and seeks it on request.
(function () {
  window.__timelines = {};
  var timeline = null;
  var failed = false;
  // The frame URL carries the engine version so a deploy never meets a stale engine.
  var version = new URLSearchParams(window.location.search).get("v") || "0";

  function post(message) {
    window.parent.postMessage(message, window.location.origin);
  }

  function fail(message) {
    if (failed || timeline) return;
    failed = true;
    post({ type: "error", message: String(message || "Stage error").slice(0, 300) });
  }

  function waitForTimeline() {
    if (failed) return;
    var built = window.__timelines.main;
    if (!built) {
      setTimeout(waitForTimeline, 30);
      return;
    }
    timeline = built;
    timeline.seek(0);
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
      waitForTimeline();
    } else if (message.type === "seek" && timeline) {
      timeline.seek(Math.max(0, Math.min(Number(message.time) || 0, timeline.duration())));
    }
  });

  // Engines build inside document.fonts.ready.then(...), so a bad plan surfaces
  // as a rejected promise, not an error event; report both.
  window.addEventListener("error", function (event) {
    fail(event.message);
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    fail(reason && reason.message ? reason.message : reason);
  });

  post({ type: "stage-ready" });
})();
