import type * as OpenAIModule from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { transcribe, upstashCommand } = vi.hoisted(() => ({
  transcribe: vi.fn(),
  upstashCommand: vi.fn(),
}));
vi.mock("~/server/storage/upstash", () => ({ upstashCommand }));
vi.mock("openai", async (importOriginal) => ({
  ...(await importOriginal<typeof OpenAIModule>()),
  default: class {
    audio = { transcriptions: { create: transcribe } };
  },
}));

import {
  readQuotaError,
  speakWithGemini,
  untilPacificMidnight,
  VoiceQuotaError,
} from "./gemini-voice";

/** A fifth of a second of 24 kHz mono silence, as Gemini's WAV. */
function silentWav(): Buffer {
  const samples = 4_800;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples * 2, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24_000, 24);
  header.writeUInt32LE(48_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples * 2, 40);
  return Buffer.concat([header, Buffer.alloc(samples * 2)]);
}

const take = () =>
  new Response(
    JSON.stringify({
      steps: [
        {
          type: "model_output",
          content: [
            {
              type: "audio",
              mime_type: "audio/wav",
              data: silentWav().toString("base64"),
            },
          ],
        },
      ],
    }),
  );

describe("the Gemini voice", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "gemini");
    vi.stubEnv("OPENAI_API_KEY", "openai");
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    upstashCommand.mockResolvedValue("OK");
    transcribe.mockResolvedValue({
      words: [
        { word: "Lost", start: 0.1, end: 0.4 },
        { word: "It", start: 0.5, end: 0.6 },
        { word: "helps", start: 0.6, end: 0.9 },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchMock.mockReset();
    transcribe.mockReset();
    upstashCommand.mockReset();
  });

  it("directs each stretch by its tag, and times the take", async () => {
    fetchMock.mockResolvedValueOnce(take());
    const result = await speakWithGemini("[curious] Lost? [warmly] It helps.");
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]![1] as RequestInit).body),
    ) as {
      model: string;
      input: Array<{
        content: Array<{ text: string; annotations: Array<{ style: string }> }>;
      }>;
      generation_config: { speech_config: Array<{ voice: string }> };
    };
    expect(body.model).toBe("gemini-3.8-flash-tts");
    expect(body.generation_config.speech_config[0]!.voice).toBe("Charon");
    const blocks = body.input[0]!.content;
    expect(blocks.map((block) => block.text)).toEqual(["Lost? ", "It helps."]);
    expect(blocks[0]!.annotations[0]!.style).toMatch(/this part curious$/);
    // The tags direct the voice; they are never in the words it reads.
    expect(blocks.map((block) => block.text).join("")).not.toContain("[");
    expect(result.voice).toBe("gemini-3.8-flash-tts:Charon");
    // MP3 frames start with an ID3 tag or a frame sync.
    expect(
      result.audio.subarray(0, 3).toString() === "ID3" ||
        result.audio[0] === 0xff,
    ).toBe(true);
    expect(result.alignment.characters.join("")).toBe(
      "[curious] Lost? [warmly] It helps.",
    );
    expect(transcribe.mock.calls[0]![0]).toMatchObject({
      model: "whisper-1",
      timestamp_granularities: ["word"],
    });
  });

  it("never prompts the transcription, and retries one that heard too little", async () => {
    fetchMock.mockResolvedValue(take());
    transcribe
      .mockResolvedValueOnce({
        words: [{ word: "Bowser", start: 9, end: 9.5 }],
      })
      .mockResolvedValueOnce({
        words: [
          { word: "Lost", start: 0.1, end: 0.4 },
          { word: "It", start: 0.5, end: 0.6 },
          { word: "helps", start: 0.6, end: 0.9 },
        ],
      });
    await speakWithGemini("Lost? It helps.");
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(transcribe.mock.calls[0]![0]).not.toHaveProperty("prompt");
  });

  it("fails rather than mistime a take it cannot hear", async () => {
    fetchMock.mockResolvedValue(take());
    transcribe.mockResolvedValue({
      words: [{ word: "Zeitgeist", start: 29, end: 30 }],
    });
    await expect(speakWithGemini("Lost? It helps.")).rejects.toThrow(
      /could not be timed/,
    );
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it("waits out a per-minute limit", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { details: [{ retryDelay: "0s" }] } }),
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(take());
    const result = await speakWithGemini("Lost? It helps.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.voice).toBe("gemini-3.8-flash-tts:Charon");
    expect(upstashCommand).not.toHaveBeenCalled();
  });

  it("pauses new videos until midnight Pacific once the day's quota is gone", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            details: [
              {
                violations: [
                  { quotaId: "GenerateRequestsPerDayPerProjectPerModel" },
                ],
              },
            ],
          },
        }),
        { status: 429 },
      ),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(speakWithGemini("Lost? It helps.")).rejects.toBeInstanceOf(
      VoiceQuotaError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [command] = upstashCommand.mock.calls[0]! as [unknown[]];
    expect(command.slice(0, 2)).toEqual(["SET", "video:v1:voice:paused-until"]);
    expect(command[3]).toBe("PX");
  });
});

describe("reading the voice quota", () => {
  it("tells a daily limit from a per-minute one", () => {
    expect(
      readQuotaError(
        '{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel","retryDelay":"37s"}',
      ),
    ).toEqual({ retryMs: 37_000, daily: false });
    expect(
      readQuotaError('{"quotaId":"GenerateRequestsPerDayPerProjectPerModel"}'),
    ).toEqual({ retryMs: null, daily: true });
  });

  it("counts down to midnight Pacific", () => {
    // 23:00 PDT on 2026-09-25 is 06:00 UTC on the 26th: an hour to go.
    expect(untilPacificMidnight(new Date("2026-09-26T06:00:00Z"))).toBe(
      3_600_000,
    );
  });
});
