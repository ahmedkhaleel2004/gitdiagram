import "server-only";

import type { VideoTiming, VideoWord } from "~/features/explainer/types";
import { speak, voicePausedUntil } from "./voice";
import { normalizeWord } from "./text";

const LEAD_IN_SECONDS = 0.4;
const TAIL_SECONDS = 3.6;

export interface Narration {
  clips: Buffer[];
  timing: VideoTiming;
  voices: Array<{ start: number }>;
  characters: number;
  /** The model and voice that read the take. */
  voice: string;
  /** Voice and transcription cost in USD, estimated from list prices. */
  costUsd: number;
}

/**
 * Whether a new video can be voiced now: false for a while after the voice's
 * balance ran out (see voice.ts), so no run pays for a script it
 * cannot voice.
 * If Redis cannot say, the budget check that follows fails closed anyway.
 */
export async function isNarrationAvailable(): Promise<boolean> {
  return (await voicePausedUntil().catch(() => null)) === null;
}

const seconds = (value: number) => Number(value.toFixed(3));

/**
 * Voice the whole script as one continuous take, so the delivery carries from
 * scene to scene the way a storyteller's does (separate takes per scene each
 * restarted the voice's tone and joined with a gap), then split the take back
 * into beats with the word timestamps. A scene starts on a new paragraph,
 * which the voice reads as a slightly longer breath.
 *
 * A VoiceUnavailableError (the voice's balance ran out) is passed on as it
 * is, so the caller can tell it apart.
 */
export async function narrateBeats(
  beats: Array<{ narration: string; scene: string }>,
  signal?: AbortSignal,
): Promise<Narration> {
  let text = "";
  const spans = beats.map((beat, index) => {
    const said = beat.narration;
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

  const take = await speak(text, signal);
  const words = take.words.map((word): VideoWord & { offset: number } => ({
    w: normalizeWord(text.slice(word.from, word.to)),
    s: seconds(LEAD_IN_SECONDS + word.start),
    e: seconds(LEAD_IN_SECONDS + word.end),
    offset: word.from,
  }));
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
  // The film runs past the take's real end, even when the transcription
  // stopped hearing words before it.
  const soundEnd = Math.max(speechEnd, LEAD_IN_SECONDS + take.seconds);
  return {
    clips: [take.audio],
    timing: {
      DURATION: Math.ceil((soundEnd + TAIL_SECONDS) * 10) / 10,
      SPEECH_END: seconds(speechEnd),
      beats: timing,
    },
    voices: [{ start: LEAD_IN_SECONDS }],
    characters: text.length,
    voice: take.voice,
    costUsd: take.costUsd,
  };
}
