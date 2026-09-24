// The live player's stage. The parent page owns audio and the clock; this frame
// only builds the scene timeline from the plan it is sent and seeks it on request.
(function () {
  window.__timelines = {};
  var timeline = null;

  function post(message) {
    window.parent.postMessage(message, window.location.origin);
  }

  function waitForTimeline() {
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
      // Version 2 plans use the free-form shot engine; version 1 the scene templates.
      engine.src = message.engine === "shots.js" ? "shots.js" : "engine.js";
      engine.onerror = function () {
        post({ type: "error", message: "The scene engine failed to load." });
      };
      document.body.appendChild(engine);
      waitForTimeline();
    } else if (message.type === "seek" && timeline) {
      timeline.seek(Math.max(0, Math.min(Number(message.time) || 0, timeline.duration())));
    }
  });

  window.addEventListener("error", function (event) {
    post({ type: "error", message: String(event.message || "Stage error") });
  });

  post({ type: "stage-ready" });
})();
