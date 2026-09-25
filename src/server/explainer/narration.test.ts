import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  hasNarrationCredits,
  narrateBeats,
  resetNarrationCreditsCache,
} from "./narration";

/** A fake take: every character lasts 0.05 s, so offsets map straight to time. */
function takeFor(text: string) {
  const characters = [...text];
  return {
    audio_base64: Buffer.from("mp3").toString("base64"),
    alignment: {
      characters,
      character_start_times_seconds: characters.map((_, i) => i * 0.05),
      character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.05),
    },
  };
}

describe("narrateBeats", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("ELEVENLABS_API_KEY", "key");
    vi.stubEnv("VIDEO_TTS_MODEL", "");
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const { text } = JSON.parse(String(init.body)) as { text: string };
      return new Response(JSON.stringify(takeFor(text)));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("records the whole script as one take and splits it back into beats", async () => {
    const narration = await narrateBeats([
      {
        scene: "a",
        narration: "You open a repo,",
        spoken: "[curious] You open a repo,",
      },
      { scene: "a", narration: "and get lost", spoken: "and get lost" },
      {
        scene: "b",
        narration: "So it draws a map.",
        spoken: "So it draws a map.",
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { text } = JSON.parse(
      String((fetchMock.mock.calls[0]![1] as RequestInit).body),
    ) as { text: string };
    // Mid-sentence beats run on; a scene ends on a full stop and the next
    // starts a new paragraph.
    expect(text).toBe(
      "[curious] You open a repo, and get lost.\n\nSo it draws a map.",
    );

    expect(narration.clips).toHaveLength(1);
    expect(narration.voices).toEqual([{ start: 0.4 }]);
    expect(
      narration.timing.beats.map((beat) => beat.words.map((w) => w.w)),
    ).toEqual([
      ["you", "open", "a", "repo"],
      ["and", "get", "lost"],
      ["so", "it", "draws", "a", "map"],
    ]);
    const [first, second, third] = narration.timing.beats;
    // "You" follows the ten-character tag and its space, after the lead-in.
    expect(first!.start).toBeCloseTo(0.4 + 10 * 0.05);
    expect(second!.start).toBeGreaterThan(first!.end);
    expect(third!.start).toBeGreaterThan(second!.end);
    expect(narration.timing.SPEECH_END).toBeCloseTo(0.4 + text.length * 0.05);
  });

  it("keeps words in their beat after an emoji", async () => {
    const narration = await narrateBeats([
      { scene: "a", narration: "Rocket 🚀", spoken: "Rocket 🚀" },
      { scene: "a", narration: "then more", spoken: "then more" },
      { scene: "b", narration: "Next scene", spoken: "Next scene" },
    ]);
    const beats = narration.timing.beats.map((beat) =>
      beat.words.map((w) => w.w).filter(Boolean),
    );
    expect(beats).toEqual([["rocket"], ["then", "more"], ["next", "scene"]]);
  });

  it("holds a beat with no aligned words where the one before ended", async () => {
    // The voice skipped the middle beat: its characters come back blank.
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const { text } = JSON.parse(String(init.body)) as { text: string };
      return new Response(
        JSON.stringify(takeFor(text.replace("and so", "      "))),
      );
    });
    const narration = await narrateBeats([
      { scene: "a", narration: "Hello there", spoken: "Hello there" },
      { scene: "a", narration: "and so", spoken: "and so" },
      { scene: "a", narration: "goodbye", spoken: "goodbye" },
    ]);
    const [first, second] = narration.timing.beats;
    expect(second!.words).toEqual([]);
    expect(second!.start).toBe(first!.end);
    expect(second!.end).toBe(first!.end);
  });

  it("stops waiting between retries once the run is aborted", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => {
      controller.abort(new Error("deadline"));
      return new Response("busy", { status: 429 });
    });
    const started = Date.now();
    await expect(
      narrateBeats(
        [{ scene: "a", narration: "Hi", spoken: "Hi" }],
        controller.signal,
      ),
    ).rejects.toThrow("deadline");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("hasNarrationCredits", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetNarrationCreditsCache();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  const balance = (remaining: number) =>
    new Response(
      JSON.stringify({ character_count: 0, character_limit: remaining }),
    );

  it("says no when the balance has never been readable", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    expect(await hasNarrationCredits()).toBe(false);
  });

  it("uses a recent balance when a fresh read fails", async () => {
    fetchMock.mockResolvedValueOnce(balance(50_000));
    expect(await hasNarrationCredits()).toBe(true);
    fetchMock.mockRejectedValue(new Error("down"));
    vi.advanceTimersByTime(6 * 60_000);
    expect(await hasNarrationCredits()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Too old to trust.
    vi.advanceTimersByTime(30 * 60_000);
    expect(await hasNarrationCredits()).toBe(false);
  });

  it("says no when the balance is low", async () => {
    fetchMock.mockResolvedValueOnce(balance(100));
    expect(await hasNarrationCredits()).toBe(false);
  });
});
