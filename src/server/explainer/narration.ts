import "server-only";

import type { VideoTiming, VideoWord } from "~/features/explainer/types";
import { normalizeWord } from "./text";

const ELEVENLABS_API = "https://api.elevenlabs.io";
const DEFAULT_VOICE_ID = "iP95p4xoKVk53GoZ742B"; // "Chris": warm, conversational
// multilingual_v2 honors `speed` (eleven_v3 ignores it) and accepts the
// previous/next-text hints that keep prosody continuous across scene takes.
const DEFAULT_TTS_MODEL = "eleven_multilingual_v2";
// Natural pace. Sped-up takes (1.18 was tried) clip the pauses between
// sentences and sound rushed; the script is written short enough instead.
const DEFAULT_SPEED = 1;
// ElevenLabs Starter allows four concurrent requests; one beat per request.
const CONCURRENCY = 4;
const LEAD_IN_SECONDS = 0.4;
const TAIL_SECONDS = 3.6;
// A breath between scenes, where the picture changes.
const SCENE_GAP_SECONDS = 0.5;

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
  context: { previous?: string; next?: string },
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
          ...(model !== "eleven_v3" && context.previous
            ? { previous_text: context.previous }
            : {}),
          ...(model !== "eleven_v3" && context.next
            ? { next_text: context.next }
            : {}),
          voice_settings: {
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

/** Words with clock times and their character offset in the spoken text. */
function spokenWords(
  alignment: Alignment,
  offset: number,
): Array<VideoWord & { offset: number }> {
  const words: Array<VideoWord & { offset: number }> = [];
  let text = "";
  let s = 0;
  let e = 0;
  let from = -1;
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
 * Voice each scene as one continuous take (natural flow, no stitched silences),
 * in parallel, then split the take back into beats with the character timestamps.
 */
export async function narrateBeats(
  beats: Array<{ narration: string; scene: string }>,
  signal?: AbortSignal,
): Promise<Narration> {
  const scenes: Array<{
    text: string;
    beats: Array<{ index: number; from: number; to: number }>;
  }> = [];
  beats.forEach((beat, index) => {
    let scene = scenes.at(-1);
    if (!scene || beats[index - 1]?.scene !== beat.scene) {
      scene = { text: "", beats: [] };
      scenes.push(scene);
    }
    const line = /[.!?…]$/.test(beat.narration)
      ? beat.narration
      : `${beat.narration}.`;
    if (scene.text) scene.text += " ";
    scene.beats.push({
      index,
      from: scene.text.length,
      to: scene.text.length + line.length,
    });
    scene.text += line;
  });

  const takes: Array<{ audio: Buffer; alignment: Alignment }> = new Array(
    scenes.length,
  );
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, scenes.length) }, async () => {
      while (next < scenes.length) {
        const index = next++;
        takes[index] = await speak(
          scenes[index]!.text,
          { previous: scenes[index - 1]?.text, next: scenes[index + 1]?.text },
          signal,
        );
      }
    }),
  );

  let cursor = LEAD_IN_SECONDS;
  const timing: VideoTiming["beats"] = new Array(beats.length);
  const voices: Narration["voices"] = [];
  scenes.forEach((scene, k) => {
    const { alignment } = takes[k]!;
    const start = cursor;
    voices.push({ start: Number(start.toFixed(3)) });
    const words = spokenWords(alignment, start);
    for (const beat of scene.beats) {
      const own = words.filter(
        (word) => word.offset >= beat.from && word.offset < beat.to,
      );
      timing[beat.index] = {
        start: own[0]?.s ?? start,
        end: own.at(-1)?.e ?? start,
        words: own.map(({ w, s, e }) => ({ w, s, e })),
      };
    }
    cursor =
      start +
      (alignment.character_end_times_seconds.at(-1) ?? 0) +
      SCENE_GAP_SECONDS;
  });
  const speechEnd = timing.at(-1)?.end ?? 0;
  return {
    clips: takes.map((take) => take.audio),
    timing: {
      DURATION: Math.ceil((speechEnd + TAIL_SECONDS) * 10) / 10,
      SPEECH_END: Number(speechEnd.toFixed(3)),
      beats: timing,
    },
    voices,
    characters: scenes.reduce((sum, scene) => sum + scene.text.length, 0),
  };
}
