// Facts about the scene engine (public/video-engine) shared by the browser
// player and the server's MP4 renderer, so both draw and mix the same film.

/** Bump with any change under public/video-engine so no browser pairs new data with a cached engine. */
export const ENGINE_VERSION = "18";

export const STAGE_PATH = `/video-engine/stage.html?v=${ENGINE_VERSION}`;

/**
 * Measured peak of each effect (dBFS). Hits are normalized to a -6 dB peak and
 * then set to the gain the scene engine asked for. Only short, untuned foley:
 * pitched chimes read as dings over narration and long beds as scratching, so
 * cues naming anything else are skipped.
 */
export const SFX_PEAK_DB: Record<string, number> = {
  pop: -5.3,
  stamp: -10.4,
  tick: -5.9,
  whoosh: -0.7,
};

/** Final level of the whole mix, voice included. */
export const MASTER_GAIN = 0.9;

function dbToGain(db: number) {
  return 10 ** (db / 20);
}

/** Linear gain for one effect hit, before the master gain. */
export function sfxGain(name: string, cueGainDb: number) {
  return dbToGain(-6 - (SFX_PEAK_DB[name] ?? -6) + cueGainDb);
}
