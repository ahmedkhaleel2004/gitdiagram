import "server-only";

import type { VideoTiming } from "~/features/explainer/types";

// The vertical MP4 is a feed cut of the film: it starts on the first word,
// every long pause is shortened, and it stops soon after the last word. The
// cut is a time edit: consecutive stretches of the film's clock, each played
// over some length of the MP4's clock. A stretch played at its own length is
// kept as it is; a pause is played faster, so whatever moves in it (a scene
// change, a camera move) still plays through, only quicker. The picture seeks
// the film to `sourceTime`; the sound keeps both ends of a shortened pause and
// drops its middle, where nothing is said, so no word is ever sped up or cut.

/** [from, to, length]: the film's [from, to) seconds, played over `length` seconds. */
export type TimeEdit = Array<[number, number, number]>;

/** A silent stretch of the narration, in seconds on the film's clock. */
export type Silence = [number, number];

/** The longest pause a feed cut keeps. */
export const FEED_PAUSE = 0.3;
/** Kept before the first sound, so the first word never starts clipped. */
const FEED_LEAD = 0.06;
/** Kept after the last word: the end card (in under the last line) settles. */
const FEED_TAIL = 0.9;

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * The feed cut of a film, from its timing and the silences measured in its
 * narration (the word timings alone are not trusted to find pauses: the
 * transcription sometimes hears a gap in the middle of a word).
 */
export function planFeedEdit(params: {
  timing: VideoTiming;
  silences: Silence[];
}): TimeEdit {
  const { timing } = params;
  const silences = params.silences
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const duration = timing.DURATION;
  const firstWord = timing.beats.find((beat) => beat.words.length)?.words[0];
  // Sound starts where the leading silence ends (or with the first word the
  // transcription heard, if that is earlier).
  const leading = silences[0] && silences[0][0] <= 0.05 ? silences[0][1] : 0;
  const firstSound = Math.min(leading, firstWord?.s ?? leading);
  const start = Math.max(0, Math.min(duration, firstSound - FEED_LEAD));
  // A silence that runs to the end of the narration marks its last sound.
  const trailing = silences.at(-1);
  const lastSound =
    trailing && !Number.isFinite(trailing[1]) ? trailing[0] : duration;
  const end = Math.min(
    duration,
    Math.max(lastSound, timing.SPEECH_END) + FEED_TAIL,
  );
  if (end <= start) return [[0, round(duration), round(duration)]];

  // Whole milliseconds, so a kept stretch's length is exactly to - from.
  const edit: TimeEdit = [];
  const keep = (from: number, to: number) =>
    edit.push([from, to, round(to - from)]);
  let cursor = round(start);
  const stop = round(end);
  for (const [silentFrom, silentTo] of silences) {
    const a = round(Math.max(silentFrom, cursor));
    const b = round(Math.min(silentTo, stop));
    // The hold after the last word is the tail, not a pause.
    if (b >= stop || b - a <= FEED_PAUSE) continue;
    if (a > cursor) keep(cursor, a);
    edit.push([a, b, FEED_PAUSE]);
    cursor = b;
  }
  if (stop > cursor) keep(cursor, stop);
  return edit;
}

/** How long a cut runs. */
export function editDuration(edit: TimeEdit): number {
  return edit.reduce((sum, [, , length]) => sum + length, 0);
}

/** The film's time shown at `t` seconds into the cut. */
export function sourceTime(edit: TimeEdit, t: number): number {
  let at = 0;
  for (const [from, to, length] of edit) {
    if (t < at + length)
      return from + (Math.max(0, t - at) * (to - from)) / length;
    at += length;
  }
  return edit.at(-1)?.[1] ?? t;
}

/** Where the film's time `s` falls in the cut, or null if the cut leaves it out. */
export function outputTime(edit: TimeEdit, s: number): number | null {
  let at = 0;
  for (const [from, to, length] of edit) {
    if (s >= from && s < to) return at + ((s - from) * length) / (to - from);
    at += length;
  }
  return null;
}

/**
 * The stretches of narration a cut keeps, as [from, to) on the film's clock
 * placed `at` seconds into the cut: a kept stretch whole, a shortened pause
 * as its first and last halves. Stretches that meet are joined.
 */
export function audioPieces(
  edit: TimeEdit,
): Array<{ from: number; to: number; at: number }> {
  const pieces: Array<{ from: number; to: number; at: number }> = [];
  const add = (from: number, to: number, at: number) => {
    const last = pieces.at(-1);
    if (
      last &&
      Math.abs(last.to - from) < 5e-4 &&
      Math.abs(last.at + (last.to - last.from) - at) < 5e-4
    )
      last.to = to;
    else pieces.push({ from, to, at });
  };
  let at = 0;
  for (const [from, to, length] of edit) {
    if (Math.abs(to - from - length) < 5e-4) add(from, to, at);
    else {
      add(from, from + length / 2, at);
      add(to - length / 2, to, at + length / 2);
    }
    at += length;
  }
  return pieces.map(({ from, to, at: place }) => ({
    from: round(from),
    to: round(to),
    at: round(place),
  }));
}

/**
 * Silences from ffmpeg's silencedetect, printed by ametadata: each
 * lavfi.silence_start and the lavfi.silence_end after it. A silence still
 * open when the sound ends runs to Infinity.
 */
export function parseSilences(printed: string): Silence[] {
  const silences: Silence[] = [];
  let open: number | null = null;
  for (const line of printed.split("\n")) {
    const match = /^lavfi\.silence_(start|end)=(-?[\d.]+)/.exec(line.trim());
    if (!match) continue;
    const value = Math.max(0, Number(match[2]));
    if (match[1] === "start") open = value;
    else if (open !== null) {
      silences.push([open, value]);
      open = null;
    }
  }
  if (open !== null) silences.push([open, Infinity]);
  return silences;
}
