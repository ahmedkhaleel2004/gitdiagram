import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { speakWithGemini, voicePausedUntil } = vi.hoisted(() => ({
  speakWithGemini: vi.fn(),
  voicePausedUntil: vi.fn(),
}));
vi.mock("./gemini-voice", () => ({
  speakWithGemini,
  voicePausedUntil,
  isGeminiVoiceConfigured: () => true,
}));

import { isNarrationAvailable, narrateBeats } from "./narration";

/** A fake take: every character lasts 0.05 s, so offsets map straight to time. */
function takeFor(text: string) {
  const characters = text.split("");
  return {
    audio: Buffer.from("mp3"),
    voice: "gemini-3.8-flash-tts:Charon",
    alignment: {
      characters,
      character_start_times_seconds: characters.map((_, i) => i * 0.05),
      character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.05),
    },
  };
}

describe("narrateBeats", () => {
  beforeEach(() => {
    speakWithGemini.mockImplementation(async (text: string) => takeFor(text));
  });

  afterEach(() => {
    speakWithGemini.mockReset();
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

    expect(speakWithGemini).toHaveBeenCalledTimes(1);
    const text = speakWithGemini.mock.calls[0]![0] as string;
    // Mid-sentence beats run on; a scene ends on a full stop and the next
    // starts a new paragraph. Tags stay in, as direction for the voice.
    expect(text).toBe(
      "[curious] You open a repo, and get lost.\n\nSo it draws a map.",
    );

    expect(narration.clips).toHaveLength(1);
    expect(narration.voice).toBe("gemini-3.8-flash-tts:Charon");
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
    speakWithGemini.mockImplementation(async (text: string) =>
      takeFor(text.replace("and so", "      ")),
    );
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
});

describe("isNarrationAvailable", () => {
  afterEach(() => voicePausedUntil.mockReset());

  it("holds new videos back while the voice quota is used up", async () => {
    voicePausedUntil.mockResolvedValueOnce(Date.now() + 60_000);
    expect(await isNarrationAvailable()).toBe(false);
    voicePausedUntil.mockResolvedValueOnce(null);
    expect(await isNarrationAvailable()).toBe(true);
  });
});
