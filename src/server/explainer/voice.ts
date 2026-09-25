import "server-only";

import OpenAI, { toFile } from "openai";
import { runProcess } from "~/server/child-process";
import { logEvent } from "~/server/log";
import { upstashCommand } from "~/server/storage/upstash";
import { alignTake, type TimedWord } from "./voice-alignment";

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
// The take's format: 24 kHz, mono, 16-bit.
const PCM_BYTES_PER_SECOND = 24_000 * 2;
// Encoding a minute of speech takes ffmpeg well under a second.
const ENCODE_TIMEOUT_MS = 30_000;

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
  logEvent("error", "video.voice.paused", {
    reason,
    until: new Date(until).toISOString(),
  });
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
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason as Error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
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
      await response.body?.cancel().catch(() => undefined);
      await pauseVoice(OUT_OF_CREDIT_PAUSE_MS, "credit");
      throw new VoiceUnavailableError("The voice balance has run out.");
    }
    // Busy upstream or a server error: tried again, a little later each time.
    // The unread body is let go first, so it does not hold the connection.
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await response.body?.cancel().catch(() => undefined);
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
async function toMp3(pcm: Buffer, signal?: AbortSignal): Promise<Buffer> {
  const ffmpeg = (await import("ffmpeg-static")).default as unknown as
    string | null;
  if (!ffmpeg) throw new Error("No ffmpeg binary for this platform.");
  return runProcess(
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
    {
      input: pcm,
      stdout: true,
      signal,
      timeoutMs: ENCODE_TIMEOUT_MS,
      label: "ffmpeg",
    },
  );
}

// What voicing costs, estimated from list prices (OpenRouter's speech
// endpoint returns only audio, no usage): Gemini 3.8 Flash TTS bills $0.50
// per million text tokens in and $9 per million audio tokens out, at 25 audio
// tokens a second; whisper-1 bills $0.006 a minute of audio.
const TEXT_TOKEN_USD = 0.5 / 1e6;
const AUDIO_TOKEN_USD = 9 / 1e6;
const AUDIO_TOKENS_PER_SECOND = 25;
const TRANSCRIPTION_USD_PER_MINUTE = 0.006;

/** One take and its transcription; text is about four characters a token. */
const voicingCostUsd = (text: string, seconds: number) =>
  (text.length / 4) * TEXT_TOKEN_USD +
  seconds * AUDIO_TOKENS_PER_SECOND * AUDIO_TOKEN_USD +
  (seconds / 60) * TRANSCRIPTION_USD_PER_MINUTE;

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

export interface Take {
  /** The whole take as MP3. */
  audio: Buffer;
  /** Every word of the script (runs of non-space) with its time in the take. */
  words: TimedWord[];
  /** The take's exact length. */
  seconds: number;
  /** The model and voice that read it. */
  voice: string;
  /** What every take recorded and its transcription cost, estimated. */
  costUsd: number;
}

/**
 * The whole script as one take, as MP3, with every word timed.
 *
 * A transcription that hears too little of the script would put scenes on
 * the wrong words, so the script is read once more (a new reading is usually
 * heard cleanly). If that one is not heard well either, its words are spread
 * over the take by length rather than failing a run already paid for.
 */
export async function speak(text: string, signal?: AbortSignal): Promise<Take> {
  let costUsd = 0;
  for (let attempt = 0; ; attempt++) {
    const pcm = await requestTake(text, signal);
    const seconds = pcm.length / PCM_BYTES_PER_SECOND;
    costUsd += voicingCostUsd(text, seconds);
    const audio = await toMp3(pcm, signal);
    const alignment = alignTake(text, await heardWords(audio, signal), seconds);
    const take = { audio, seconds, voice: `${VOICE_MODEL}:${VOICE_NAME}` };
    if (alignment.total && alignment.matched / alignment.total >= MIN_MATCHED)
      return { ...take, words: alignment.words, costUsd };
    if (attempt >= 1) {
      logEvent("warn", "video.voice.untimed", {
        matched: alignment.matched,
        words: alignment.total,
        seconds: Number(seconds.toFixed(1)),
      });
      return { ...take, words: alignTake(text, [], seconds).words, costUsd };
    }
  }
}
