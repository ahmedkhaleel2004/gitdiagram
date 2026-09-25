// @ts-check
// The shot engine's sound: every hit a builder asks for, then the few the
// film keeps (window.__SFX, which the player and the renderer mix).
(function (kit) {
  kit.sound = function () {
    // Builders ask for hits freely; mixSfx (run once the film is built) keeps a
    // sparse, varied few: short untuned foley only, the scene change plus at most
    // three hits a scene, never the same sound twice within three seconds, and
    // every repeat slightly re-pitched so nothing sounds copy-pasted.
    var SFX = (/** @type {any} */ (window).__SFX = []);
    var sfxWanted = [];
    var sfxScene = 0;
    var SFX_RANK = { whoosh: 3, stamp: 2, pop: 1, tick: 0 };
    function sfx(name, t, gain, rate, transition) {
      sfxWanted.push({ name: name, t: Math.max(0, t), gain: gain || 0, rate: rate || 1, scene: sfxScene, transition: Boolean(transition) });
    }
    function mixSfx() {
      var PER_SCENE = 3;
      var perScene = {};
      var picked = [];
      sfxWanted
        .slice()
        .sort(function (a, b) {
          return b.transition - a.transition || SFX_RANK[b.name] - SFX_RANK[a.name] || a.t - b.t;
        })
        .forEach(function (c) {
          if (!c.transition && (perScene[c.scene] || 0) >= PER_SCENE) return;
          for (var i = 0; i < picked.length; i++) {
            var gap = Math.abs(picked[i].t - c.t);
            if (gap < 0.7 || (picked[i].name === c.name && gap < 3)) return;
          }
          if (!c.transition) perScene[c.scene] = (perScene[c.scene] || 0) + 1;
          picked.push(c);
        });
      var RATE = [1, 0.93, 1.07, 0.96, 1.11, 0.9];
      var GAIN = [0, -1.5, -0.5, -2.5, -1];
      var seen = {};
      picked
        .sort(function (a, b) { return a.t - b.t; })
        .forEach(function (c) {
          var k = (seen[c.name] = (seen[c.name] || 0) + 1) - 1;
          SFX.push({ name: c.name, t: Number(c.t.toFixed(3)), gain: c.gain + GAIN[k % GAIN.length], rate: Number((c.rate * RATE[k % RATE.length]).toFixed(3)) });
        });
    }
    return {
      sfx: sfx,
      mix: mixSfx,
      /** The scene the hits asked for next belong to. */
      scene: function (/** @type {number} */ k) {
        sfxScene = k;
      },
    };
  };
})((/** @type {any} */ (window).ShotKit = /** @type {any} */ (window).ShotKit || {}));
