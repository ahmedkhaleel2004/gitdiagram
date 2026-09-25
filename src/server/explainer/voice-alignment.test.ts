import { describe, expect, it } from "vitest";

import { alignTake, speechSegments } from "./voice-alignment";

/** The time a script word got: the start of its first character, the end of its last. */
function timeOf(
  text: string,
  alignment: ReturnType<typeof alignTake>,
  word: string,
) {
  const from = text.indexOf(word);
  return [
    alignment.character_start_times_seconds[from],
    alignment.character_end_times_seconds[from + word.length - 1],
  ];
}

describe("voice alignment", () => {
  it("splits the script at its delivery tags", () => {
    expect(
      speechSegments("You open a repo. [curious] Lost? [warmly] It helps."),
    ).toEqual([
      { tag: null, text: "You open a repo. " },
      { tag: "curious", text: "Lost? " },
      { tag: "warmly", text: "It helps." },
    ]);
  });

  it("times each script word from the words heard", () => {
    const text = "[curious] So what happens next?";
    const alignment = alignTake(text, [
      { word: "So", start: 0.1, end: 0.3 },
      { word: "what", start: 0.3, end: 0.5 },
      { word: "happens", start: 0.5, end: 0.9 },
      { word: "next?", start: 0.9, end: 1.2 },
    ]);
    expect(alignment.characters.join("")).toBe(text);
    expect(timeOf(text, alignment, "So")).toEqual([0.1, 0.3]);
    expect(timeOf(text, alignment, "happens")).toEqual([0.5, 0.9]);
    // The tag holds the time before the first word.
    expect(alignment.character_start_times_seconds[0]).toBe(0);
  });

  it("shares the time of words heard differently between their neighbours", () => {
    const text = "It gets a four twenty two error.";
    const alignment = alignTake(text, [
      { word: "It", start: 0, end: 0.2 },
      { word: "gets", start: 0.2, end: 0.4 },
      { word: "a", start: 0.4, end: 0.5 },
      { word: "422", start: 0.5, end: 1.4 },
      { word: "error.", start: 1.4, end: 1.8 },
    ]);
    const [fourStart, fourEnd] = timeOf(text, alignment, "four");
    const [, twoEnd] = timeOf(text, alignment, "two");
    expect(fourStart).toBe(0.5);
    expect(fourEnd).toBeLessThan(twoEnd!);
    expect(twoEnd).toBeLessThanOrEqual(1.4);
    expect(timeOf(text, alignment, "error.")).toEqual([1.4, 1.8]);
  });

  it("keeps time moving forward when the transcription wobbles", () => {
    const alignment = alignTake("one two three", [
      { word: "one", start: 0.5, end: 0.8 },
      { word: "two", start: 0.2, end: 0.3 },
      { word: "three", start: 0.9, end: 1.2 },
    ]);
    const starts = alignment.character_start_times_seconds;
    for (let i = 1; i < starts.length; i++)
      expect(starts[i]).toBeGreaterThanOrEqual(starts[i - 1]!);
  });
});
