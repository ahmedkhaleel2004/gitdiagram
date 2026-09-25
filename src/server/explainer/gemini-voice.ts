import "server-only";

import { spawn } from "node:child_process";
import OpenAI, { toFile } from "openai";
import { upstashCommand } from "~/server/storage/upstash";
import { alignTake, speechSegments, type Alignment } from "./voice-alignment";

// Gemini 3.8 Flash TTS, voice Charon, narrates every video: it won a blind
// bake-off by ear (experiments/voices). It returns audio only, so whisper-1
// transcribes the take with word times, which are matched back onto the
// script (voice-alignment.ts).
//
// The script's delivery tags ([curious], [warmly]) become the style of the
// words after them: Gemini 3.8 reads `text` verbatim and takes direction
// from each block's speech_metadata style.
//
// The Gemini API limits requests per minute and per day. A per-minute limit
// is waited out. A used-up day pauses new videos until Google's quota resets
// (midnight Pacific), so no run pays for a script it cannot voice.

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
const VOICE_MODEL = "gemini-3.8-flash-tts";
const VOICE_NAME = "Charon";
const STYLE =
  "a warm, confident senior engineer telling a smart colleague the story of a project they love; natural conversational pace with varied rhythm, breathing at commas and full stops";
// One take of a minute's script comes back in well under this.
const TAKE_TIMEOUT_MS = 90_000;
// Waits for a per-minute limit longer than this pause videos instead.
const MAX_QUOTA_WAIT_MS = 65_000;
const PAUSE_KEY = "video:v1:voice:paused-until";

/** The day's voice quota is used up; new videos are paused until it resets. */
export class VoiceQuotaError extends Error {}

export function isGeminiVoiceConfigured(): boolean {
  return Boolean(
    process.env.GEMINI_API_KEY?.trim() && process.env.OPENAI_API_KEY?.trim(),
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

/** Milliseconds until Google's daily quotas reset, at midnight Pacific. */
export function untilPacificMidnight(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const part = (type: string) =>
    Number(parts.find((each) => each.type === type)?.value ?? 0);
  const elapsed =
    (part("hour") * 3600 + part("minute") * 60 + part("second")) * 1000;
  return 86_400_000 - elapsed;
}

/** What a 429 says: how long to wait, and whether the day's quota is gone. */
export function readQuotaError(body: string): {
  retryMs: number | null;
  daily: boolean;
} {
  const retry = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  return {
    retryMs: retry ? Math.ceil(Number(retry[1]) * 1000) : null,
    daily: /PerDay/i.test(body),
  };
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

async function takeFromGemini(
  text: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    const timeout = AbortSignal.timeout(TAKE_TIMEOUT_MS);
    const response = await fetch(`${GEMINI_API}/interactions`, {
      method: "POST",
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY?.trim() ?? "",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: VOICE_MODEL,
        input: [
          {
            type: "user_input",
            content: speechSegments(text).map((segment) => ({
              type: "text",
              text: segment.text,
              annotations: [
                {
                  type: "speech_metadata",
                  style: segment.tag
                    ? `${STYLE}; this part ${segment.tag}`
                    : STYLE,
                },
              ],
            })),
          },
        ],
        response_format: { type: "audio", mime_type: "audio/wav" },
        generation_config: { speech_config: [{ voice: VOICE_NAME }] },
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (response.status === 429) {
      const quota = readQuotaError(await response.text());
      if (quota.daily) {
        await pauseVoice(untilPacificMidnight(), "daily");
        throw new VoiceQuotaError("Today's voice quota is used up.");
      }
      const retryMs = quota.retryMs ?? 20_000;
      if (retryMs > MAX_QUOTA_WAIT_MS || attempt >= 3) {
        await pauseVoice(Math.max(retryMs, 60_000), "rate");
        throw new VoiceQuotaError("The voice is at its rate limit.");
      }
      await wait(retryMs + Math.random() * 1_000, signal);
      continue;
    }
    // A server error is tried once more.
    if (response.status >= 500 && attempt < 1) {
      await wait(2_000, signal);
      continue;
    }
    if (!response.ok)
      throw new Error(
        `The voice failed (${response.status}): ${(await response.text()).slice(0, 200)}`,
      );
    const body = (await response.json()) as {
      steps?: Array<{ content?: Array<{ type?: string; data?: string }> }>;
    };
    const audio = body.steps
      ?.flatMap((step) => step.content ?? [])
      .find((part) => part.type === "audio" && part.data);
    if (!audio?.data) throw new Error("The voice returned no audio.");
    return Buffer.from(audio.data, "base64");
  }
}

/** Gemini's 24 kHz WAV as the 44.1 kHz, 128 kbps MP3 every stored take uses. */
async function toMp3(wav: Buffer): Promise<Buffer> {
  const ffmpeg = (await import("ffmpeg-static")).default as unknown as
    string | null;
  if (!ffmpeg) throw new Error("No ffmpeg binary for this platform.");
  const child = spawn(
    ffmpeg,
    [
      "-loglevel",
      "error",
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
  child.stdin.end(wav);
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
 * `text` (tags included; narration.ts skips them when it reads words out).
 */
export async function speakWithGemini(
  text: string,
  signal?: AbortSignal,
): Promise<{ audio: Buffer; alignment: Alignment; voice: string }> {
  const audio = await toMp3(await takeFromGemini(text, signal));
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
