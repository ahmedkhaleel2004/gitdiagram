import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { VideoTiming } from "~/features/explainer/types";
import {
  audioPieces,
  editDuration,
  FEED_PAUSE,
  outputTime,
  parseSilences,
  planFeedEdit,
  sourceTime,
  type TimeEdit,
} from "./feed-edit";

/** A film: the take starts at 0.4 s, words as [start, end] pairs. */
function timing(words: Array<[number, number]>, duration: number): VideoTiming {
  return {
    DURATION: duration,
    SPEECH_END: words.at(-1)![1],
    beats: [
      {
        start: words[0]![0],
        end: words.at(-1)![1],
        words: words.map(([s, e], k) => ({ w: `w${k}`, s, e })),
      },
    ],
  };
}

describe("the feed cut", () => {
  // Words at 0.6-2.0 and 3.5-5.0 and 5.2-9.0; the film runs to 12.6 s.
  const film = timing(
    [
      [0.6, 2],
      [3.5, 5],
      [5.2, 9],
    ],
    12.6,
  );
  const silences: Array<[number, number]> = [
    [0, 0.62],
    [2.02, 3.48],
    [5.02, 5.18],
    [9.05, Infinity],
  ];

  it("starts on the first sound, shortens long pauses and stops soon after the last word", () => {
    const edit = planFeedEdit({ timing: film, silences });
    expect(edit).toEqual([
      // From just before the first word (heard at 0.6 s).
      [0.54, 2.02, 1.48],
      [2.02, 3.48, FEED_PAUSE],
      // A pause no longer than the longest kept one is left alone, and the
      // cut holds 0.9 s past the last sound.
      [3.48, 9.95, 6.47],
    ]);
    expect(editDuration(edit)).toBeCloseTo(1.48 + FEED_PAUSE + 6.47, 6);
    // Well short of the film's 12.6 s, with its silent end card gone.
    expect(editDuration(edit)).toBeLessThan(8.5);
  });

  it("never shortens where the narration is not silent, whatever the word timings say", () => {
    // The transcription heard a 1.5 s gap mid-sentence; the audio did not
    // (and it never fell silent at the end, so the whole film is kept).
    const edit = planFeedEdit({ timing: film, silences: [[0, 0.62]] });
    expect(edit).toEqual([[0.54, 12.6, 12.06]]);
  });

  it("keeps the whole film when the cut would be empty", () => {
    const empty = timing([[0, 0]], 0);
    expect(planFeedEdit({ timing: empty, silences: [] })).toEqual([[0, 0, 0]]);
  });

  it("maps the cut's clock to the film's and back", () => {
    const edit: TimeEdit = [
      [1, 3, 2],
      [3, 5, 0.5],
      [5, 8, 3],
    ];
    expect(sourceTime(edit, 0)).toBe(1);
    expect(sourceTime(edit, 1.5)).toBe(2.5);
    // A shortened pause plays faster: its 2 s pass in half a second.
    expect(sourceTime(edit, 2.25)).toBe(4);
    expect(sourceTime(edit, 3.5)).toBe(6);
    expect(sourceTime(edit, 99)).toBe(8);
    for (const t of [0, 0.7, 2.1, 2.4, 3, 5.4])
      expect(outputTime(edit, sourceTime(edit, t))).toBeCloseTo(t, 9);
    expect(outputTime(edit, 0.5)).toBeNull();
    expect(outputTime(edit, 8)).toBeNull();
  });

  it("keeps both ends of a shortened pause for the sound and drops its middle", () => {
    const edit: TimeEdit = [
      [1, 3, 2],
      [3, 5, 0.5],
      [5, 8, 3],
    ];
    expect(audioPieces(edit)).toEqual([
      { from: 1, to: 3.25, at: 0 },
      { from: 4.75, to: 8, at: 2.25 },
    ]);
    // Together they last exactly as long as the cut.
    const pieces = audioPieces(edit);
    const last = pieces.at(-1)!;
    expect(last.at + last.to - last.from).toBeCloseTo(editDuration(edit), 9);
  });
});

describe("reading ffmpeg's silences", () => {
  it("pairs starts with ends and leaves a final open silence running", () => {
    const printed = [
      "frame:4    pts:8192    pts_time:0.18576",
      "lavfi.silence_start=0",
      "frame:14   pts:23400   pts_time:0.530612",
      "lavfi.silence_end=0.541293",
      "lavfi.silence_duration=0.541293",
      "lavfi.silence_start=2.36832",
      "lavfi.silence_end=2.88805",
      "lavfi.silence_start=54.0206",
      "",
    ].join("\n");
    expect(parseSilences(printed)).toEqual([
      [0, 0.541293],
      [2.36832, 2.88805],
      [54.0206, Infinity],
    ]);
    expect(parseSilences("")).toEqual([]);
  });
});
