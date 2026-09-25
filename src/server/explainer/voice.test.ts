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

import { speak, VoiceUnavailableError } from "./voice";

/** A fifth of a second of silence, as the raw 24 kHz 16-bit PCM the voice sends. */
const take = () => new Response(Buffer.alloc(9_600));

const heard = {
  words: [
    { word: "Lost", start: 0.1, end: 0.4 },
    { word: "It", start: 0.5, end: 0.6 },
    { word: "helps", start: 0.6, end: 0.9 },
  ],
};

describe("the voice", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter");
    vi.stubEnv("OPENAI_API_KEY", "openai");
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    upstashCommand.mockResolvedValue("OK");
    transcribe.mockResolvedValue(heard);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchMock.mockReset();
    transcribe.mockReset();
    upstashCommand.mockReset();
  });

  it("reads the words without their tags in Charon's voice, and times the take", async () => {
    fetchMock.mockResolvedValueOnce(take());
    const result = await speak("[curious] Lost? [warmly] It helps.");
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(url).toBe("https://openrouter.ai/api/v1/audio/speech");
    expect(body).toMatchObject({
      model: "google/gemini-3.8-flash-tts",
      voice: "Charon",
      response_format: "pcm",
      // Read inline, the voice would speak a tag.
      input: "Lost? It helps.",
    });
    expect(result.voice).toBe("google/gemini-3.8-flash-tts:Charon");
    // MP3 frames start with an ID3 tag or a frame sync.
    expect(
      result.audio.subarray(0, 3).toString() === "ID3" ||
        result.audio[0] === 0xff,
    ).toBe(true);
    // The alignment covers the tagged text; narration.ts skips the tags.
    expect(result.alignment.characters.join("")).toBe(
      "[curious] Lost? [warmly] It helps.",
    );
    expect(transcribe.mock.calls[0]![0]).toMatchObject({
      model: "whisper-1",
      timestamp_granularities: ["word"],
    });
    expect(transcribe.mock.calls[0]![0]).not.toHaveProperty("prompt");
  });

  it("retries a transcription that heard too little", async () => {
    fetchMock.mockResolvedValue(take());
    transcribe
      .mockResolvedValueOnce({
        words: [{ word: "Bowser", start: 9, end: 9.5 }],
      })
      .mockResolvedValueOnce(heard);
    await speak("Lost? It helps.");
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it("fails rather than mistime a take it cannot hear", async () => {
    fetchMock.mockResolvedValue(take());
    transcribe.mockResolvedValue({
      words: [{ word: "Zeitgeist", start: 29, end: 30 }],
    });
    await expect(speak("Lost? It helps.")).rejects.toThrow(
      /could not be timed/,
    );
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it("tries again when the voice is busy", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(take());
    await speak("Lost? It helps.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("pauses new videos when the balance runs out", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 402 }));
    await expect(speak("Lost? It helps.")).rejects.toBeInstanceOf(
      VoiceUnavailableError,
    );
    const [command] = upstashCommand.mock.calls[0]! as [unknown[]];
    expect(command.slice(0, 2)).toEqual(["SET", "video:v1:voice:paused-until"]);
  });
});
