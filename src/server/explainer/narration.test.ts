import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { narrateBeats } from "./narration";

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
});
