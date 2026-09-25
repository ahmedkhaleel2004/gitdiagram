import "server-only";

import { spawn } from "node:child_process";
import OpenAI, { toFile } from "openai";
import { upstashCommand } from "~/server/storage/upstash";
import { alignTake, type Alignment } from "./voice-alignment";

// The narrator: OpenRouter's text-to-speech with Gemini 3.8 Flash TTS and
// the Charon voice, chosen by ear in a blind bake-off (experiments/voices).
// OpenRouter bills per use from a prepaid balance. The audio comes back
// without timings, so whisper-1 transcribes the take with word times, which
// are matched back onto the script (voice-alignment.ts).
//
// One style directs the whole take; punctuation in the script paces it.
//
// There is no other voice. When the OpenRouter balance runs out, new videos
// pause (see voicePausedUntil) instead of paying for scripts no one can voice.

const SPEECH_API = "https://openrouter.ai/api/v1/audio/speech";
const VOICE_MODEL = "google/gemini-3.8-flash-tts";
const VOICE_NAME = "Charon";
const STYLE =
  "a warm, confident senior engineer telling a smart colleague the story of a project they love; natural conversational pace with varied rhythm, breathing at commas and full stops";
// One take of a minute's script comes back in well under this.
const TAKE_TIMEOUT_MS = 90_000;
const PAUSE_KEY = "video:v1:voice:paused-until";
// How long new videos wait after the balance ran out before trying again.
const OUT_OF_CREDIT_PAUSE_MS = 10 * 60_000;

/** The voice cannot be paid for right now; new videos are paused. */
export class VoiceUnavailableError extends Error {}

export function isVoiceConfigured(): boolean {
  return Boolean(
    process.env.OPENROUTER_API_KEY?.trim() &&
    process.env.OPENAI_API_KEY?.trim(),
  );
}

/** When paused new videos may start again (ms), or null when they may now. */
export async function voicePausedUntil(): Promise<number | null> {
  const until = Number(await upstashCommand<string | null>(["GET", PAUSE_KEY]));
  return until > Date.now() ? until : null;
}

async function pauseVoice(ms: number, reason: string) {
  const until = Date.now() + ms;
  console.error(
    JSON.stringify({
      event: "video.voice.paused",
      reason,
      until: new Date(until).toISOString(),
    }),
  );
  await upstashCommand(["SET", PAUSE_KEY, String(until), "PX", ms]).catch(
    () => undefined,
  );
}

/** The OpenRouter balance left in USD, for /admin; null when unreadable. */
export async function voiceCreditUsd(): Promise<number | null> {
  const response = await fetch("https://openrouter.ai/api/v1/credits", {
    headers: {
      authorization: `Bearer ${process.env.OPENROUTER_API_KEY?.trim() ?? ""}`,
    },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    data?: { total_credits?: number; total_usage?: number };
  };
  const { total_credits: credits, total_usage: usage } = body.data ?? {};
  return typeof credits === "number" && typeof usage === "number"
    ? credits - usage
    : null;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason as Error);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });
}

/** The take as raw 24 kHz mono 16-bit PCM, the only format this model returns. */
async function requestTake(
  text: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    const timeout = AbortSignal.timeout(TAKE_TIMEOUT_MS);
    const response = await fetch(SPEECH_API, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY?.trim() ?? ""}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: VOICE_MODEL,
        input: text,
        voice: VOICE_NAME,
        response_format: "pcm",
        provider: {
          options: {
            "google-ai-studio": { speech_metadata: { style: STYLE } },
          },
        },
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (response.status === 402) {
      await pauseVoice(OUT_OF_CREDIT_PAUSE_MS, "credit");
      throw new VoiceUnavailableError("The voice balance has run out.");
    }
    // Busy upstream or a server error: tried again, a little later each time.
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await wait(1_500 * 2 ** attempt, signal);
      continue;
    }
    if (!response.ok)
      throw new Error(
        `The voice failed (${response.status}): ${(await response.text()).slice(0, 200)}`,
      );
    const audio = Buffer.from(await response.arrayBuffer());
    if (!audio.length) throw new Error("The voice returned no audio.");
    return audio;
  }
}

/** The PCM take as the 44.1 kHz, 128 kbps MP3 every stored take uses. */
async function toMp3(pcm: Buffer): Promise<Buffer> {
  const ffmpeg = (await import("ffmpeg-static")).default as unknown as
    string | null;
  if (!ffmpeg) throw new Error("No ffmpeg binary for this platform.");
  const child = spawn(
    ffmpeg,
    [
      "-loglevel",
      "error",
      "-f",
      "s16le",
      "-ar",
      "24000",
      "-ac",
      "1",
      "-i",
      "pipe:0",
      "-ar",
      "44100",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      "-f",
      "mp3",
      "pipe:1",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const chunks: Buffer[] = [];
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-1000);
  });
  const done = new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  child.stdin.end(pcm);
  const code = await done;
  if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${stderr}`);
  return Buffer.concat(chunks);
}

// Share of script words the transcription must hear exactly for its times to
// be trusted; a clean take scores above 0.9 (names like "Zustand" can differ).
const MIN_MATCHED = 0.75;

/**
 * Words heard in the take, with times. No prompt: given the script as one,
 * whisper-1 often hallucinated or dropped half the take.
 */
async function heardWords(mp3: Buffer, signal?: AbortSignal) {
  const transcription = await new OpenAI().audio.transcriptions.create(
    {
      model: "whisper-1",
      file: await toFile(mp3, "take.mp3", { type: "audio/mpeg" }),
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    },
    { signal },
  );
  return transcription.words ?? [];
}

/**
 * The whole script as one take, as MP3, with a character alignment over
 * `text`.
 */
export async function speak(
  text: string,
  signal?: AbortSignal,
): Promise<{ audio: Buffer; alignment: Alignment; voice: string }> {
  const audio = await toMp3(await requestTake(text, signal));
  // A transcription that hears too little of the script would put scenes on
  // the wrong words, so it is tried once more, then the run fails.
  for (let attempt = 0; ; attempt++) {
    const alignment = alignTake(text, await heardWords(audio, signal));
    if (alignment.words && alignment.matched / alignment.words >= MIN_MATCHED)
      return { audio, alignment, voice: `${VOICE_MODEL}:${VOICE_NAME}` };
    if (attempt >= 1)
      throw new Error(
        `The take could not be timed (${alignment.matched} of ${alignment.words} words heard).`,
      );
  }
}
