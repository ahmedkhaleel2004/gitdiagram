import "server-only";

import type { VideoTiming, VideoWord } from "~/features/explainer/types";
import { normalizeWord } from "./text";

const ELEVENLABS_API = "https://api.elevenlabs.io";
const DEFAULT_VOICE_ID = "iP95p4xoKVk53GoZ742B"; // "Chris": warm, conversational
// eleven_v3 acts: it varies pace and pitch with the sense of a line, runs
// through lists and holds on an ellipsis, and performs the script's delivery
// tags. It ignores `speed`, so that only goes to the older models
// (multilingual_v2 via VIDEO_TTS_MODEL), which read the plain narration
// because they would speak a tag aloud. v3 takes up to 5,000 characters, far
// more than a sixty-second script.
const DEFAULT_TTS_MODEL = "eleven_v3";
// Natural pace for the older models. Sped-up takes (1.18 was tried) clip the
// pauses between sentences and sound rushed.
const DEFAULT_SPEED = 1;
const LEAD_IN_SECONDS = 0.4;
const TAIL_SECONDS = 3.6;

interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface Narration {
  clips: Buffer[];
  timing: VideoTiming;
  voices: Array<{ start: number }>;
  characters: number;
}

export function isNarrationConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY?.trim());
}

// A video takes about 800 credits; keep room for runs already in flight.
const MIN_CREDITS = Math.max(
  0,
  Number.parseInt(process.env.VIDEO_MIN_TTS_CREDITS ?? "", 10) || 2_000,
);
let creditsCache: { at: number; remaining: number | null } | null = null;

/**
 * The voice account's remaining credits, read live and cached five minutes
 * per instance; null when the balance cannot be read.
 */
export async function narrationCreditsRemaining(): Promise<number | null> {
  if (!creditsCache || Date.now() - creditsCache.at > 5 * 60_000) {
    let remaining: number | null = null;
    try {
      const response = await fetch(`${ELEVENLABS_API}/v1/user/subscription`, {
        headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY?.trim() ?? "" },
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        const body = (await response.json()) as {
          character_count?: number;
          character_limit?: number;
        };
        if (
          typeof body.character_count === "number" &&
          typeof body.character_limit === "number"
        )
          remaining = body.character_limit - body.character_count;
      }
    } catch {
      remaining = null;
    }
    creditsCache = { at: Date.now(), remaining };
  }
  return creditsCache.remaining;
}

/**
 * Whether the voice account can narrate another video, so new videos stop
 * cleanly instead of failing halfway once the credits run out. An unreadable
 * balance counts as enough: narration itself will then report the real error.
 */
export async function hasNarrationCredits(): Promise<boolean> {
  const remaining = await narrationCreditsRemaining();
  return remaining === null || remaining >= MIN_CREDITS;
}

const ttsModel = () => process.env.VIDEO_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL;

async function speak(
  text: string,
  signal?: AbortSignal,
): Promise<{ audio: Buffer; alignment: Alignment }> {
  const voice = process.env.VIDEO_TTS_VOICE_ID?.trim() || DEFAULT_VOICE_ID;
  const model = ttsModel();
  const v3 = model === "eleven_v3";
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(
      `${ELEVENLABS_API}/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY?.trim() ?? "",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: model,
          seed: 7,
          // v3 stability is Creative (0), Natural (0.5) or Robust (1). Creative
          // is livelier but can drift off script, which an unattended run can't catch.
          voice_settings: v3
            ? { stability: 0.5, similarity_boost: 0.8, use_speaker_boost: true }
            : {
                stability: 0.45,
                similarity_boost: 0.8,
                style: 0.15,
                use_speaker_boost: true,
                speed: Number(process.env.VIDEO_TTS_SPEED) || DEFAULT_SPEED,
              },
        }),
        signal,
      },
    );
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 1200 * 2 ** attempt));
      continue;
    }
    if (!response.ok)
      throw new Error(
        `Narration failed (${response.status}): ${(await response.text()).slice(0, 200)}`,
      );
    const body = (await response.json()) as {
      audio_base64: string;
      alignment: Alignment;
    };
    return {
      audio: Buffer.from(body.audio_base64, "base64"),
      alignment: body.alignment,
    };
  }
}

/**
 * Words with clock times and their character offset in the spoken text. Delivery
 * tags come back in the alignment as characters too; they are skipped, so the
 * words line up one to one with the caption's.
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
      from = index;
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
  const tagged = ttsModel() === "eleven_v3";
  let text = "";
  const spans = beats.map((beat, index) => {
    const said = tagged ? beat.spoken : beat.narration;
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

  const { audio, alignment } = await speak(text, signal);
  const words = spokenWords(alignment, LEAD_IN_SECONDS);
  const timing: VideoTiming["beats"] = spans.map((span) => {
    const own = words.filter(
      (word) => word.offset >= span.from && word.offset < span.to,
    );
    return {
      start: own[0]?.s ?? LEAD_IN_SECONDS,
      end: own.at(-1)?.e ?? LEAD_IN_SECONDS,
      words: own.map(({ w, s, e }) => ({ w, s, e })),
    };
  });
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
  };
}
