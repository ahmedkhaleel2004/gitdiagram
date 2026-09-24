import "server-only";

import type { VideoPlan, VideoTiming, VideoWord } from "~/features/video/types";
import { normalizeWord } from "./plan-schema";

const ELEVENLABS_API = "https://api.elevenlabs.io";
const DEFAULT_VOICE_ID = "iP95p4xoKVk53GoZ742B"; // "Chris": warm, conversational
const DEFAULT_TTS_MODEL = "eleven_v3";
// ElevenLabs Starter allows four concurrent requests; one beat per request.
const CONCURRENCY = 4;
const LEAD_IN_SECONDS = 0.6;
const TAIL_SECONDS = 3.8;

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

async function speak(
  text: string,
  signal?: AbortSignal,
): Promise<{ audio: Buffer; alignment: Alignment }> {
  const voice = process.env.VIDEO_TTS_VOICE_ID?.trim() || DEFAULT_VOICE_ID;
  const model = process.env.VIDEO_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL;
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
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8,
            style: 0,
            use_speaker_boost: true,
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

function spokenWords(alignment: Alignment, offset: number): VideoWord[] {
  const words: VideoWord[] = [];
  let current: { text: string; s: number; e: number } | null = null;
  alignment.characters.forEach((character, index) => {
    if (/\s/.test(character)) {
      if (current) words.push(toWord(current, offset));
      current = null;
      return;
    }
    current ??= {
      text: "",
      s: alignment.character_start_times_seconds[index] ?? 0,
      e: 0,
    };
    current.text += character;
    current.e = alignment.character_end_times_seconds[index] ?? current.s;
  });
  if (current) words.push(toWord(current, offset));
  return words;
}

function toWord(word: { text: string; s: number; e: number }, offset: number) {
  return {
    w: normalizeWord(word.text),
    s: Number((offset + word.s).toFixed(3)),
    e: Number((offset + word.e).toFixed(3)),
  };
}

/** Voice every beat in parallel, then lay the clips on one clock with structural pauses. */
export async function narratePlan(
  plan: VideoPlan,
  signal?: AbortSignal,
): Promise<Narration> {
  const beats = plan.beats;
  const spoken: Array<{ audio: Buffer; alignment: Alignment }> = new Array(
    beats.length,
  );
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, beats.length) }, async () => {
      while (next < beats.length) {
        const index = next++;
        spoken[index] = await speak(beats[index]!.narration, signal);
      }
    }),
  );

  let cursor = LEAD_IN_SECONDS;
  const timing: VideoTiming["beats"] = [];
  const voices: Narration["voices"] = [];
  beats.forEach((beat, index) => {
    const { alignment } = spoken[index]!;
    const start = cursor;
    const end = start + (alignment.character_end_times_seconds.at(-1) ?? 0);
    voices.push({ start: Number(start.toFixed(3)) });
    timing.push({
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      words: spokenWords(alignment, start),
    });
    // Pauses carry structure: longer between chapters and around the big idea.
    const following = beats[index + 1];
    let gap = 0.34;
    if (following && following.chapter !== beat.chapter) gap += 0.16;
    if (
      following &&
      (following.scene.type === "idea" || beat.scene.type === "idea")
    )
      gap += 0.3;
    if (following?.scene.type === "close") gap += 0.25;
    cursor = end + gap;
  });
  const speechEnd = timing.at(-1)?.end ?? 0;
  return {
    clips: spoken.map((entry) => entry.audio),
    timing: {
      DURATION: Math.ceil((speechEnd + TAIL_SECONDS) * 10) / 10,
      SPEECH_END: Number(speechEnd.toFixed(3)),
      beats: timing,
    },
    voices,
    characters: beats.reduce((sum, beat) => sum + beat.narration.length, 0),
  };
}
