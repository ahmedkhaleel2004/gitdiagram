import {
  clip,
  plainText,
  record,
  records,
  withoutStrangeAddresses,
  writtenLine,
} from "./text";

// The director's script: checked, measured and shown to the designers.

interface ScriptBeat {
  scene: string;
  /** What the voice reads, the captions show and the cues match. */
  narration: string;
  brief: string;
}
export interface Script {
  title: string;
  outro: string;
  beats: ScriptBeat[];
}

// At a natural speaking pace (about 2.1 words a second, with pauses) this
// keeps the film near a minute. Longer scripts go back to the director once.
export const SCRIPT_WORD_TARGET = 125;
export const SCRIPT_WORD_LIMIT = 140;
/** The prompt asks for twelve to sixteen beats; more also goes back once. */
export const MAX_BEATS = 22;
// Far past anything a director writes; only bounds a runaway reply.
const MAX_RAW_BEATS = 64;

/**
 * The director's script, cleaned. `repository` is the material the director
 * read; sentences naming web addresses it does not contain never reach the
 * voice or the screen (see withoutStrangeAddresses).
 */
export function normalizeScript(
  raw: unknown,
  name: string,
  repository = "",
): Script {
  const input = record(raw);
  let removed = false;
  const clean = (value: unknown) => {
    const line = plainText(value);
    const kept = withoutStrangeAddresses(line, repository);
    if (kept !== line) removed = true;
    return kept;
  };
  const beats = records(input.beats)
    .slice(0, MAX_RAW_BEATS)
    .map((beat) => ({
      scene: clip(beat.scene, 24) || "s",
      narration: writtenLine(clean(beat.narration)),
      brief: clip(beat.brief, 900),
    }))
    .filter((beat) => beat.narration);
  const script = {
    title: clip(clean(input.title) || name, 28),
    outro: clip(clean(input.outro), 60),
    beats,
  };
  if (removed)
    console.warn(JSON.stringify({ event: "video.script.address_removed" }));
  if (beats.length < 4) throw new Error("The script has too few beats.");
  return script;
}

export function scriptWordCount(script: Script): number {
  return script.beats.reduce(
    (sum, beat) => sum + beat.narration.split(/\s+/).filter(Boolean).length,
    0,
  );
}

/**
 * The script within MAX_BEATS without losing a word: while it has too many
 * beats, the two adjacent beats with the fewest words between them are
 * joined (within one scene when possible). The ending always survives.
 */
export function fitBeats(script: Script): Script {
  if (script.beats.length <= MAX_BEATS) return script;
  const beats = [...script.beats];
  const words = (beat: ScriptBeat) => beat.narration.split(/\s+/).length;
  while (beats.length > MAX_BEATS) {
    let best = -1;
    let bestCost = Infinity;
    for (let i = 0; i + 1 < beats.length; i++) {
      const a = beats[i]!;
      const b = beats[i + 1]!;
      // Joining across scenes moves a scene boundary, so it comes last.
      const cost = words(a) + words(b) + (a.scene === b.scene ? 0 : 1_000);
      if (cost < bestCost) [best, bestCost] = [i, cost];
    }
    const a = beats[best]!;
    const b = beats[best + 1]!;
    beats.splice(best, 2, {
      scene: a.scene,
      narration: `${a.narration} ${b.narration}`,
      brief: clip(`${a.brief} Then: ${b.brief}`, 900),
    });
  }
  return { ...script, beats };
}

/** The script as designers see it: numbered beats with scene and brief. */
export function scriptForDesigners(script: Script): string {
  return script.beats
    .map(
      (beat, index) =>
        `${index}. [${beat.scene}] "${beat.narration}" — ${beat.brief}`,
    )
    .join("\n");
}
