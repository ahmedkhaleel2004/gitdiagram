// One function per transcription service: an MP3 in, heard words with times
// out, in the shape voice-alignment.ts takes. None is given the script.
import { cf, openAiKey, type Heard } from "./lib";

export interface Transcript {
  words: Heard[];
  text: string;
  ms: number;
  /** HTTP attempts it took (Workers AI can answer 429 or 5xx when busy). */
  attempts: number;
}

type Provider = (mp3: Buffer) => Promise<Omit<Transcript, "ms" | "attempts">>;

async function workersAi(model: string, init: RequestInit): Promise<any> {
  const response = await cf(`/ai/run/${model}`, { method: "POST", ...init });
  const text = await response.text();
  if (!response.ok)
    throw Object.assign(
      new Error(`${model} ${response.status}: ${text.slice(0, 300)}`),
      { status: response.status },
    );
  return (JSON.parse(text) as { result: any }).result;
}

/** Production today: exactly the call in src/server/explainer/voice.ts. */
const whisper1: Provider = async (mp3) => {
  const form = new FormData();
  form.set("model", "whisper-1");
  form.set("file", new File([mp3], "take.mp3", { type: "audio/mpeg" }));
  form.set("response_format", "verbose_json");
  form.set("timestamp_granularities[]", "word");
  const response = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { authorization: `Bearer ${openAiKey()}` },
      body: form,
    },
  );
  if (!response.ok)
    throw Object.assign(
      new Error(
        `whisper-1 ${response.status}: ${(await response.text()).slice(0, 300)}`,
      ),
      { status: response.status },
    );
  const body = (await response.json()) as { text: string; words?: Heard[] };
  return { text: body.text, words: body.words ?? [] };
};

/** Raw audio bytes as the body; words at the top level. */
const classic =
  (model: string): Provider =>
  async (mp3) => {
    const result = await workersAi(model, {
      body: mp3,
      headers: { "content-type": "application/octet-stream" },
    });
    return { text: result.text ?? "", words: result.words ?? [] };
  };

/** Base64 audio in JSON; words sit inside segments. */
const turbo =
  (options: Record<string, unknown> = {}): Provider =>
  async (mp3) => {
    const result = await workersAi("@cf/openai/whisper-large-v3-turbo", {
      body: JSON.stringify({ audio: mp3.toString("base64"), ...options }),
      headers: { "content-type": "application/json" },
    });
    const words: Heard[] = [];
    for (const segment of result.segments ?? [])
      for (const word of segment.words ?? [])
        words.push({ word: word.word, start: word.start, end: word.end });
    return { text: result.text ?? "", words };
  };

/** Deepgram on Workers AI: raw audio with its content type. */
const nova3: Provider = async (mp3) => {
  const result = await workersAi("@cf/deepgram/nova-3", {
    body: mp3,
    headers: { "content-type": "audio/mpeg" },
  });
  const best = result.results?.channels?.[0]?.alternatives?.[0];
  return {
    text: best?.transcript ?? "",
    words: (best?.words ?? []).map((word: Heard) => ({
      word: word.word,
      start: word.start,
      end: word.end,
    })),
  };
};

export const PROVIDERS: Record<
  string,
  { run: Provider; usdPerMinute: number | null; label: string }
> = {
  "whisper-1": {
    run: whisper1,
    usdPerMinute: 0.006,
    label: "OpenAI whisper-1 (production today)",
  },
  turbo: {
    run: turbo(),
    usdPerMinute: 0.000513,
    label: "Workers AI whisper-large-v3-turbo, defaults",
  },
  "turbo-vad": {
    run: turbo({ vad_filter: true }),
    usdPerMinute: 0.000513,
    label: "Workers AI whisper-large-v3-turbo, vad_filter",
  },
  "turbo-en": {
    run: turbo({ language: "en", condition_on_previous_text: false }),
    usdPerMinute: 0.000513,
    label:
      "Workers AI whisper-large-v3-turbo, language en, no conditioning on previous text",
  },
  whisper: {
    run: classic("@cf/openai/whisper"),
    usdPerMinute: 0.000453,
    label: "Workers AI whisper (the original model)",
  },
  "tiny-en": {
    run: classic("@cf/openai/whisper-tiny-en"),
    usdPerMinute: null,
    label: "Workers AI whisper-tiny-en (beta)",
  },
  "nova-3": {
    run: nova3,
    usdPerMinute: 0.0052,
    label: "Workers AI Deepgram nova-3",
  },
};

export async function transcribe(
  name: string,
  mp3: Buffer,
): Promise<Transcript> {
  for (let attempt = 1; ; attempt++) {
    const started = performance.now();
    try {
      const out = await PROVIDERS[name]!.run(mp3);
      return {
        ...out,
        ms: Math.round(performance.now() - started),
        attempts: attempt,
      };
    } catch (error) {
      const status = (error as { status?: number }).status ?? 0;
      if (attempt >= 4 || !(status === 429 || status >= 500)) throw error;
      await Bun.sleep(1500 * 2 ** (attempt - 1));
    }
  }
}
