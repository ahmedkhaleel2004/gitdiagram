import type * as OpenAIModule from "openai";
import type * as ChildProcessModule from "~/server/child-process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { runProcess, transcribe, upstashCommand } = vi.hoisted(() => ({
  runProcess: vi.fn(),
  transcribe: vi.fn(),
  upstashCommand: vi.fn(),
}));
vi.mock("~/server/storage/upstash", () => ({ upstashCommand }));
vi.mock("~/server/child-process", () => ({ runProcess }));
vi.mock("openai", async (importOriginal) => ({
  ...(await importOriginal<typeof OpenAIModule>()),
  default: class {
    audio = { transcriptions: { create: transcribe } };
  },
}));

import { speak, VoiceUnavailableError } from "./voice";

const actual = await vi.importActual<typeof ChildProcessModule>(
  "~/server/child-process",
);

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
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    upstashCommand.mockResolvedValue("OK");
    transcribe.mockResolvedValue(heard);
    runProcess.mockImplementation(actual.runProcess);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchMock.mockReset();
    transcribe.mockReset();
    upstashCommand.mockReset();
    runProcess.mockReset();
  });

  it("reads the script in Charon's voice, and times the take", async () => {
    fetchMock.mockResolvedValueOnce(take());
    const result = await speak("Lost? It helps.");
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(url).toBe("https://openrouter.ai/api/v1/audio/speech");
    expect(body).toMatchObject({
      model: "google/gemini-3.8-flash-tts",
      voice: "Charon",
      response_format: "pcm",
      input: "Lost? It helps.",
    });
    expect(result.voice).toBe("google/gemini-3.8-flash-tts:Charon");
    // MP3 frames start with an ID3 tag or a frame sync.
    expect(
      result.audio.subarray(0, 3).toString() === "ID3" ||
        result.audio[0] === 0xff,
    ).toBe(true);
    expect(result.seconds).toBeCloseTo(0.2);
    expect(result.words.map((word) => word.start)).toEqual([0.1, 0.5, 0.6]);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(transcribe.mock.calls[0]![0]).toMatchObject({
      model: "whisper-1",
      timestamp_granularities: ["word"],
    });
    expect(transcribe.mock.calls[0]![0]).not.toHaveProperty("prompt");
  });

  it("records a new take when the first is heard too poorly", async () => {
    fetchMock.mockImplementation(async () => take());
    transcribe
      .mockResolvedValueOnce({
        words: [{ word: "Bowser", start: 9, end: 9.5 }],
      })
      .mockResolvedValueOnce(heard);
    const result = await speak("Lost? It helps.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(result.words.map((word) => word.start)).toEqual([0.1, 0.5, 0.6]);
  });

  it("spreads the words over a take it cannot hear, rather than failing", async () => {
    fetchMock.mockImplementation(async () => take());
    transcribe.mockResolvedValue({
      words: [{ word: "Zeitgeist", start: 29, end: 30 }],
    });
    const result = await speak("Lost? It helps.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(result.words[0]!.start).toBe(0);
    expect(result.words.at(-1)!.end).toBeCloseTo(0.2);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("video.voice.untimed"),
    );
  });

  it("tries again when the voice is busy, letting go of the busy reply", async () => {
    const busy = new Response("{}", { status: 429 });
    const cancel = vi.spyOn(busy.body!, "cancel");
    fetchMock.mockResolvedValueOnce(busy).mockResolvedValueOnce(take());
    await speak("Lost? It helps.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalled();
  });

  it("gives up after the voice keeps failing", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      async () => new Response("down", { status: 503 }),
    );
    const speaking = speak("Lost? It helps.");
    const failed = expect(speaking).rejects.toThrow(/voice failed \(503\)/);
    await vi.runAllTimersAsync();
    await failed;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("stops waiting to retry as soon as the run is aborted", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      async () => new Response("down", { status: 503 }),
    );
    const controller = new AbortController();
    const speaking = speak("Lost? It helps.", controller.signal);
    const failed = expect(speaking).rejects.toThrow("deadline");
    await vi.advanceTimersByTimeAsync(100);
    controller.abort(new Error("deadline"));
    await failed;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no abort listener behind after a retry wait", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(take());
    const speaking = speak("Lost? It helps.", controller.signal);
    await vi.runAllTimersAsync();
    await speaking;
    const waits = add.mock.calls.filter(([type]) => type === "abort");
    for (const [, listener] of waits)
      expect(remove).toHaveBeenCalledWith("abort", listener);
  });

  it("fails the take, not the server, when ffmpeg exits early", async () => {
    fetchMock.mockResolvedValueOnce(take());
    runProcess.mockRejectedValueOnce(new Error("ffmpeg failed (1): bad"));
    await expect(speak("Lost? It helps.")).rejects.toThrow(/ffmpeg failed/);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("encodes through runProcess with the run's signal and a time limit", async () => {
    fetchMock.mockResolvedValueOnce(take());
    const controller = new AbortController();
    await speak("Lost? It helps.", controller.signal);
    const [, , options] = runProcess.mock.calls[0]! as [
      string,
      string[],
      ChildProcessModule.RunProcessOptions,
    ];
    expect(options).toMatchObject({
      stdout: true,
      signal: controller.signal,
      label: "ffmpeg",
    });
    expect(options.input).toHaveLength(9_600);
    expect(options.timeoutMs).toBeGreaterThan(0);
  });

  it("an ffmpeg that quits without reading its input only fails the take", async () => {
    // A real early exit: writing the take to a closed stdin raises EPIPE.
    runProcess.mockImplementation((_binary: string, _args: string[], options) =>
      actual.runProcess("/bin/sh", ["-c", "exit 3"], options),
    );
    fetchMock.mockResolvedValueOnce(new Response(Buffer.alloc(4_000_000)));
    await expect(speak("Lost? It helps.")).rejects.toThrow(
      /ffmpeg failed \(3\)/,
    );
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
