/**
 * Voice bake-off: the same video scripts narrated by several TTS models.
 *
 *   bun --conditions=react-server experiments/voices/run.ts [variant,...]
 *
 * Keys come from ~/.config/gitdiagram. Output lands in experiments/voices/out.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = join(process.cwd(), "experiments", "voices", "out");
const key = async (name: string) =>
  (
    await readFile(join(homedir(), ".config", "gitdiagram", name), "utf8")
  ).trim();

interface Beat {
  scene: string;
  narration: string;
  spoken: string;
}

// Two real scripts Claude Opus wrote in the model experiment.
const SCRIPTS: Record<string, string> = {
  fastapi:
    "experiments/video-models/out/runs/opus-low/.video-cache/video/v1/fastapi/fastapi/report.json",
  zustand:
    "experiments/video-models/out/runs/opus-low/.video-cache/video/v1/pmndrs/zustand/report.json",
};

/** The text as production voices it: beats joined, scenes split by a blank line, each scene ending on a stop. */
function takeText(beats: Beat[], tagged: boolean): string {
  let text = "";
  beats.forEach((beat, index) => {
    const said = tagged ? beat.spoken : beat.narration;
    const sceneEnds =
      index === beats.length - 1 || beats[index + 1]!.scene !== beat.scene;
    const line =
      sceneEnds && !/[.!?…]$/.test(said)
        ? `${said.replace(/[,;:]$/, "")}.`
        : said;
    if (text)
      text +=
        index > 0 && beats[index - 1]!.scene !== beat.scene ? "\n\n" : " ";
    text += line;
  });
  return text;
}

/** The tagged text as runs of words, each with the delivery tag that colours it. */
function segments(text: string): Array<{ tag: string | null; text: string }> {
  const parts = text.split(/\[([a-z ]+)\]\s*/);
  const out: Array<{ tag: string | null; text: string }> = [];
  if (parts[0]!.trim()) out.push({ tag: null, text: parts[0]! });
  for (let i = 1; i < parts.length; i += 2)
    out.push({ tag: parts[i]!, text: parts[i + 1] ?? "" });
  return out;
}

const STYLE =
  "a warm, confident senior engineer telling a smart colleague the story of a project they love; natural conversational pace with varied rhythm, breathing at commas and full stops";

function toMp3(input: Buffer, inputArgs: string[] = []): Buffer {
  return execFileSync(
    "ffmpeg",
    [
      "-loglevel",
      "error",
      ...inputArgs,
      "-i",
      "pipe:0",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      "-f",
      "mp3",
      "pipe:1",
    ],
    { input, maxBuffer: 64 * 2 ** 20 },
  );
}

async function replicate(
  model: string,
  input: Record<string, unknown>,
): Promise<Buffer> {
  const token = await key("replicate-api-token");
  type Prediction = {
    status: string;
    output?: unknown;
    error?: unknown;
    urls?: { get: string };
  };
  let prediction: Prediction = { status: "throttled" };
  // Small Replicate accounts are throttled to a few requests a minute.
  for (let attempt = 0; !prediction.urls && attempt < 8; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 12_000));
    prediction = (await (
      await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          prefer: "wait=60",
        },
        body: JSON.stringify({ input }),
      })
    ).json()) as Prediction;
  }
  while (!["succeeded", "failed", "canceled"].includes(prediction.status)) {
    await new Promise((r) => setTimeout(r, 1500));
    prediction = (await (
      await fetch(prediction.urls!.get, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as typeof prediction;
  }
  if (prediction.status !== "succeeded")
    throw new Error(`${model}: ${JSON.stringify(prediction.error)}`);
  const url = Array.isArray(prediction.output)
    ? prediction.output[0]
    : prediction.output;
  return Buffer.from(await (await fetch(String(url))).arrayBuffer());
}

async function gemini38(
  model: string,
  voice: string,
  text: string,
): Promise<Buffer> {
  const content = segments(text).map((segment) => ({
    type: "text",
    text: segment.text,
    annotations: [
      {
        type: "speech_metadata",
        style: segment.tag ? `${STYLE}; this part ${segment.tag}` : STYLE,
      },
    ],
  }));
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/interactions?key=${await key("gemini-api-key")}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        input: [{ type: "user_input", content }],
        response_format: { type: "audio", mime_type: "audio/wav" },
        generation_config: { speech_config: [{ voice }] },
      }),
    },
  );
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok)
    throw new Error(`${model}: ${JSON.stringify(body).slice(0, 600)}`);
  const audio = findAudio(body);
  if (!audio)
    throw new Error(
      `${model}: no audio in ${JSON.stringify(body).slice(0, 600)}`,
    );
  return toMp3(Buffer.from(audio, "base64"));
}

/** The first long base64 string in a response: the audio. */
function findAudio(value: unknown): string | null {
  if (typeof value === "string") return value.length > 10_000 ? value : null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAudio(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const found = findAudio(item);
      if (found) return found;
    }
  }
  return null;
}

async function gemini31(voice: string, text: string): Promise<Buffer> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${await key("gemini-api-key")}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Read this aloud as ${STYLE}. Bracketed tags set the tone of the words after them and are not spoken:\n\n${text}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
        },
      }),
    },
  );
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok)
    throw new Error(`gemini-3.1: ${JSON.stringify(body).slice(0, 600)}`);
  const audio = findAudio(body);
  if (!audio) throw new Error("gemini-3.1: no audio");
  return toMp3(Buffer.from(audio, "base64"), [
    "-f",
    "s16le",
    "-ar",
    "24000",
    "-ac",
    "1",
  ]);
}

async function openrouterSpeech(
  model: string,
  voice: string,
  text: string,
): Promise<Buffer> {
  const response = await fetch("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    headers: {
      authorization: `Bearer ${await key("openrouter-api-key")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, input: text, voice, response_format: "mp3" }),
  });
  if (!response.ok)
    throw new Error(`${model}: ${response.status} ${await response.text()}`);
  return Buffer.from(await response.arrayBuffer());
}

async function cartesia(voice: string, text: string): Promise<Buffer> {
  const response = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      authorization: `Bearer ${await key("cartesia-api-key")}`,
      "cartesia-version": "2025-04-16",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model_id: "sonic-3.6",
      transcript: text,
      voice: { mode: "id", id: voice },
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
      language: "en",
    }),
  });
  if (!response.ok)
    throw new Error(`cartesia: ${response.status} ${await response.text()}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Sonic 3's inline emotion tags in place of ours. */
const cartesiaTags = (text: string) =>
  text.replace(
    /\[([a-z]+)\]\s*/g,
    (_, tag: string) =>
      `<emotion value="${tag === "warmly" ? "affectionate" : tag}"/>`,
  );

type Variant = {
  id: string;
  label: string;
  /** USD per 1,000 characters at list price, for the report. */
  per1k: number;
  make: (beats: Beat[]) => Promise<Buffer>;
};

const VARIANTS: Variant[] = [
  {
    id: "gemini-3.8-flash-charon",
    label: "Gemini 3.8 Flash TTS · Charon",
    per1k: 0.0136,
    make: (beats) =>
      gemini38("gemini-3.8-flash-tts", "Charon", takeText(beats, true)),
  },
  {
    id: "gemini-3.8-flash-achird",
    label: "Gemini 3.8 Flash TTS · Achird",
    per1k: 0.0136,
    make: (beats) =>
      gemini38("gemini-3.8-flash-tts", "Achird", takeText(beats, true)),
  },
  {
    id: "gemini-3.8-flash-lite-charon",
    label: "Gemini 3.8 Flash-Lite TTS · Charon",
    per1k: 0.009,
    make: (beats) =>
      gemini38("gemini-3.8-flash-lite-tts", "Charon", takeText(beats, true)),
  },
  {
    id: "gemini-3.1-flash-charon",
    label: "Gemini 3.1 Flash TTS (preview) · Charon",
    per1k: 0.03,
    make: (beats) => gemini31("Charon", takeText(beats, true)),
  },
  {
    id: "inworld-tts-2-dennis",
    label: "Inworld Realtime TTS-2 · Dennis",
    per1k: 0.025,
    make: (beats) =>
      replicate("inworld/realtime-tts-2", {
        text: takeText(beats, true),
        voice_id: "Dennis",
        audio_format: "mp3",
      }),
  },
  {
    id: "minimax-2.8-hd",
    label: "MiniMax Speech 2.8 HD · Deep-Voiced Gentleman",
    per1k: 0.1,
    make: (beats) =>
      replicate("minimax/speech-2.8-hd", {
        text: takeText(beats, false),
        voice_id: "English_Deep-VoicedGentleman",
        audio_format: "mp3",
        english_normalization: true,
      }),
  },
  {
    id: "qwen-audio-3.0-plus-adrian",
    label: "Qwen-Audio-3.0-TTS-Plus · Adrian Gao",
    per1k: 0.0276,
    make: (beats) =>
      openrouterSpeech(
        "qwen/qwen-audio-3.0-tts-plus",
        "qwen-audio-3.0-tts-plus-loongadriangao",
        takeText(beats, false),
      ),
  },
  {
    id: "qwen-audio-3.0-plus-james",
    label: "Qwen-Audio-3.0-TTS-Plus · James Zhao",
    per1k: 0.0276,
    make: (beats) =>
      openrouterSpeech(
        "qwen/qwen-audio-3.0-tts-plus",
        "qwen-audio-3.0-tts-plus-loongjameszhao",
        takeText(beats, false),
      ),
  },
  {
    id: "cartesia-sonic-3.6-kyle",
    label: "Cartesia Sonic 3.6 · Kyle",
    per1k: 0.046,
    make: (beats) =>
      cartesia("c961b81c-a935-4c17-bfb3-ba2239de8c2f", takeText(beats, false)),
  },
  {
    id: "cartesia-sonic-3.6-kyle-emotion",
    label: "Cartesia Sonic 3.6 · Kyle (emotion tags)",
    per1k: 0.046,
    make: (beats) =>
      cartesia(
        "c961b81c-a935-4c17-bfb3-ba2239de8c2f",
        cartesiaTags(takeText(beats, true)),
      ),
  },
  {
    id: "cartesia-sonic-3.6-sebastian",
    label: "Cartesia Sonic 3.6 · Sebastian",
    per1k: 0.046,
    make: (beats) =>
      cartesia("b7187e84-fe22-4344-ba4a-bc013fcb533e", takeText(beats, false)),
  },
];

const only = process.argv[2]?.split(",");
const results: Record<string, unknown>[] = [];
for (const [script, path] of Object.entries(SCRIPTS)) {
  const report = JSON.parse(await readFile(path, "utf8")) as {
    script: { beats: Beat[] };
  };
  const beats = report.script.beats;
  await mkdir(join(ROOT, script), { recursive: true });
  await writeFile(join(ROOT, script, "script.txt"), takeText(beats, true));
  await Promise.all(
    VARIANTS.filter((v) => !only || only.includes(v.id)).map(
      async (variant) => {
        const started = Date.now();
        try {
          const audio = await variant.make(beats);
          const file = join(ROOT, script, `${variant.id}.mp3`);
          await writeFile(file, audio);
          const seconds = Number(
            execFileSync("ffprobe", [
              "-v",
              "error",
              "-show_entries",
              "format=duration",
              "-of",
              "csv=p=0",
              file,
            ]).toString(),
          );
          const chars = takeText(beats, false).length;
          results.push({
            script,
            id: variant.id,
            label: variant.label,
            seconds,
            ms: Date.now() - started,
            costUsd: (chars / 1000) * variant.per1k,
          });
          console.info(
            `✓ ${script} ${variant.id}: ${seconds.toFixed(1)}s audio in ${Math.round((Date.now() - started) / 1000)}s`,
          );
        } catch (error) {
          console.error(
            `✗ ${script} ${variant.id}: ${error instanceof Error ? error.message : error}`,
          );
        }
      },
    ),
  );
}
const indexPath = join(ROOT, "results.json");
const previous = JSON.parse(
  await readFile(indexPath, "utf8").catch(() => "[]"),
) as Record<string, unknown>[];
const merged = [
  ...previous.filter(
    (p) => !results.some((r) => r.script === p.script && r.id === p.id),
  ),
  ...results,
];
await writeFile(indexPath, JSON.stringify(merged, null, 2));
