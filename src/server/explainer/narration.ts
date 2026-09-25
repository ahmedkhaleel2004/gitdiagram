import "server-only";

import type { VideoTiming, VideoWord } from "~/features/explainer/types";
import {
  isGeminiVoiceConfigured,
  speakWithGemini,
  voicePausedUntil,
} from "./gemini-voice";
import { normalizeWord } from "./text";
import type { Alignment } from "./voice-alignment";

const LEAD_IN_SECONDS = 0.4;
const TAIL_SECONDS = 3.6;

export interface Narration {
  clips: Buffer[];
  timing: VideoTiming;
  voices: Array<{ start: number }>;
  characters: number;
  /** The model and voice that read the take. */
  voice: string;
}

export function isNarrationConfigured(): boolean {
  return isGeminiVoiceConfigured();
}

/**
 * Whether a new video can be voiced now: false while the day's voice quota is
 * used up (see gemini-voice.ts), so no run pays for a script it cannot voice.
 * If Redis cannot say, the budget check that follows fails closed anyway.
 */
export async function isNarrationAvailable(): Promise<boolean> {
  return (await voicePausedUntil().catch(() => null)) === null;
}

/** When new videos can be voiced again, for /admin; null when they can now. */
export function narrationPausedUntil(): Promise<number | null> {
  return voicePausedUntil();
}

/**
 * Words with clock times and their offset in the spoken text, counted in the
 * same UTF-16 units as the text itself: an alignment entry may be a whole
 * emoji, which is two units of the string, so offsets are summed from the
 * entries' own lengths rather than taken from their index. Delivery tags come
 * back in the alignment as characters too; they are skipped, so the words
 * line up one to one with the caption's.
 */
function spokenWords(
  alignment: Alignment,
  offset: number,
): Array<VideoWord & { offset: number }> {
  const words: Array<VideoWord & { offset: number }> = [];
  let text = "";
  let s = 0;
  let e = 0;
  let from = -1;
  let inTag = false;
  let position = 0;
  const flush = () => {
    if (from >= 0)
      words.push({
        w: normalizeWord(text),
        s: Number((offset + s).toFixed(3)),
        e: Number((offset + e).toFixed(3)),
        offset: from,
      });
    text = "";
    from = -1;
  };
  for (let index = 0; index < alignment.characters.length; index++) {
    const character = alignment.characters[index]!;
    const at = position;
    position += character.length;
    if (character === "[" || inTag) {
      inTag = character !== "]";
      flush();
      continue;
    }
    if (/\s/.test(character)) {
      flush();
      continue;
    }
    if (from < 0) {
      from = at;
      s = alignment.character_start_times_seconds[index] ?? 0;
    }
    text += character;
    e = alignment.character_end_times_seconds[index] ?? s;
  }
  flush();
  return words;
}

/**
 * Voice the whole script as one continuous take, so the delivery carries from
 * scene to scene the way a storyteller's does (separate takes per scene each
 * restarted the voice's tone and joined with a gap), then split the take back
 * into beats with the character timestamps. A scene starts on a new paragraph,
 * which the voice reads as a slightly longer breath.
 */
export async function narrateBeats(
  beats: Array<{ narration: string; spoken: string; scene: string }>,
  signal?: AbortSignal,
): Promise<Narration> {
  // The spoken lines keep their delivery tags; the voice takes them as direction.
  let text = "";
  const spans = beats.map((beat, index) => {
    const said = beat.spoken;
    const last = index === beats.length - 1;
    // A beat may end mid-sentence now that the take runs on, but a scene or
    // the film always ends on a full stop.
    const sceneEnds = last || beats[index + 1]?.scene !== beat.scene;
    const line =
      sceneEnds && !/[.!?…]$/.test(said)
        ? `${said.replace(/[,;:]$/, "")}.`
        : said;
    if (text)
      text +=
        index > 0 && beats[index - 1]!.scene !== beat.scene ? "\n\n" : " ";
    const from = text.length;
    text += line;
    return { from, to: text.length };
  });

  const { audio, alignment, voice } = await speakWithGemini(text, signal);
  const words = spokenWords(alignment, LEAD_IN_SECONDS);
  const timing: VideoTiming["beats"] = [];
  for (const span of spans) {
    const own = words.filter(
      (word) => word.offset >= span.from && word.offset < span.to,
    );
    // A beat with no aligned words holds where the one before it ended,
    // rather than jumping back to the start of the film.
    const previousEnd = timing.at(-1)?.end ?? LEAD_IN_SECONDS;
    timing.push({
      start: own[0]?.s ?? previousEnd,
      end: own.at(-1)?.e ?? previousEnd,
      words: own.map(({ w, s, e }) => ({ w, s, e })),
    });
  }
  const speechEnd = timing.at(-1)?.end ?? 0;
  return {
    clips: [audio],
    timing: {
      DURATION: Math.ceil((speechEnd + TAIL_SECONDS) * 10) / 10,
      SPEECH_END: Number(speechEnd.toFixed(3)),
      beats: timing,
    },
    voices: [{ start: LEAD_IN_SECONDS }],
    characters: text.length,
    voice,
  };
}
