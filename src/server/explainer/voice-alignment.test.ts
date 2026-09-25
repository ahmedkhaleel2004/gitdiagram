import { describe, expect, it } from "vitest";

import { alignTake } from "./voice-alignment";

/** The time a script word got, as [start, end]. */
function timeOf(
  text: string,
  alignment: ReturnType<typeof alignTake>,
  word: string,
) {
  const from = text.indexOf(word);
  const timed = alignment.words.find((entry) => entry.from === from)!;
  return [timed.start, timed.end];
}

/** Every word takes time, and each starts where the one before ended or later. */
function expectEachWordTimed(alignment: ReturnType<typeof alignTake>) {
  let floor = 0;
  for (const word of alignment.words) {
    expect(word.end).toBeGreaterThan(word.start);
    expect(word.start).toBeGreaterThanOrEqual(floor - 1e-9);
    floor = word.end;
  }
}

describe("voice alignment", () => {
  it("times each script word from the words heard", () => {
    const text = "So what happens next?";
    const alignment = alignTake(text, [
      { word: "So", start: 0.1, end: 0.3 },
      { word: "what", start: 0.3, end: 0.5 },
      { word: "happens", start: 0.5, end: 0.9 },
      { word: "next?", start: 0.9, end: 1.2 },
    ]);
    expect(alignment.words.map((w) => text.slice(w.from, w.to))).toEqual([
      "So",
      "what",
      "happens",
      "next?",
    ]);
    expect(timeOf(text, alignment, "So")).toEqual([0.1, 0.3]);
    expect(timeOf(text, alignment, "happens")).toEqual([0.5, 0.9]);
    expect(alignment).toMatchObject({ matched: 4, total: 4 });
  });

  it("shares a number read as words over every word said for it", () => {
    const text = "It gets a four twenty two error.";
    const alignment = alignTake(text, [
      { word: "It", start: 0, end: 0.2 },
      { word: "gets", start: 0.2, end: 0.4 },
      { word: "a", start: 0.4, end: 0.5 },
      { word: "422", start: 0.5, end: 1.4 },
      { word: "error.", start: 1.4, end: 1.8 },
    ]);
    expectEachWordTimed(alignment);
    const [fourStart, fourEnd] = timeOf(text, alignment, "four");
    const [twentyStart, twentyEnd] = timeOf(text, alignment, "twenty");
    const [twoStart, twoEnd] = timeOf(text, alignment, "two");
    expect(fourStart).toBe(0.5);
    expect(twoEnd).toBeCloseTo(1.4);
    // By length: "twenty" is twice "four" and "two" three quarters of it.
    expect(twentyEnd! - twentyStart!).toBeCloseTo(
      ((fourEnd! - fourStart!) * 6) / 4,
    );
    expect(twoEnd! - twoStart!).toBeCloseTo(((fourEnd! - fourStart!) * 3) / 4);
    expect(timeOf(text, alignment, "error.")).toEqual([1.4, 1.8]);
  });

  it("matches accented words heard without their accents", () => {
    const text = "A naïve café résumé, really.";
    const alignment = alignTake(text, [
      { word: "A", start: 0, end: 0.1 },
      { word: "naive", start: 0.1, end: 0.5 },
      { word: "cafe", start: 0.5, end: 0.9 },
      { word: "resume", start: 0.9, end: 1.4 },
      { word: "really", start: 1.4, end: 1.8 },
    ]);
    expect(alignment).toMatchObject({ matched: 5, total: 5 });
    expect(timeOf(text, alignment, "café")).toEqual([0.5, 0.9]);
  });

  it("runs words the transcription dropped at the end to the take's end", () => {
    const text = "It draws the map and then it links every box.";
    const alignment = alignTake(
      text,
      [
        { word: "It", start: 0, end: 0.2 },
        { word: "draws", start: 0.2, end: 0.6 },
        { word: "the", start: 0.6, end: 0.7 },
        { word: "map", start: 0.7, end: 1 },
        { word: "and", start: 1, end: 1.2 },
      ],
      4,
    );
    expectEachWordTimed(alignment);
    expect(timeOf(text, alignment, "then")[0]).toBe(1.2);
    expect(timeOf(text, alignment, "box.")[1]).toBeCloseTo(4);
    // Longer words take longer.
    const [linksStart, linksEnd] = timeOf(text, alignment, "links");
    const [itStart, itEnd] = timeOf(text, alignment, "it links");
    expect(linksEnd! - linksStart!).toBeGreaterThan(itEnd! - itStart!);
  });

  it("spreads the script over the take when nothing was heard", () => {
    const text = "One two eleven";
    const alignment = alignTake(text, [], 2.4);
    expectEachWordTimed(alignment);
    const [oneStart, oneEnd] = timeOf(text, alignment, "One");
    expect(oneStart).toBe(0);
    expect(oneEnd).toBeCloseTo(0.6);
    expect(timeOf(text, alignment, "eleven")).toEqual([1.2, 2.4]);
    expect(alignment).toMatchObject({ matched: 0, total: 3 });
  });

  it("keeps time moving forward when the transcription wobbles", () => {
    const alignment = alignTake("one two three", [
      { word: "one", start: 0.5, end: 0.8 },
      { word: "two", start: 0.2, end: 0.3 },
      { word: "three", start: 0.9, end: 1.2 },
    ]);
    const starts = alignment.words.map((word) => word.start);
    for (let i = 1; i < starts.length; i++)
      expect(starts[i]).toBeGreaterThanOrEqual(starts[i - 1]!);
  });

  it("times words with nothing to compare where the last word ended", () => {
    const text = "Rocket 🚀 then";
    const alignment = alignTake(text, [
      { word: "Rocket", start: 0, end: 0.5 },
      { word: "then", start: 0.8, end: 1 },
    ]);
    expect(alignment.words).toHaveLength(3);
    expect(timeOf(text, alignment, "🚀")).toEqual([0.5, 0.5]);
    expect(alignment.total).toBe(2);
  });
});
