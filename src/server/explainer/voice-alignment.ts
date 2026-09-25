// Timing for the take (voice.ts): a transcription gives words with times,
// and these are matched back onto the script's words, which narration.ts
// splits into beats.

/** A script word (a run of non-space characters) and when it is said. */
export interface TimedWord {
  /** Where the word sits in the script text: `text.slice(from, to)`. */
  from: number;
  to: number;
  /** Seconds into the take. */
  start: number;
  end: number;
}

export interface HeardWord {
  word: string;
  start: number;
  end: number;
}

/**
 * A word as compared: lower case, accents dropped (whisper hears "café" and
 * may write "cafe"), letters and digits in any script kept.
 */
const comparable = (word: string) =>
  word
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

interface Timed {
  start: number;
  end: number;
  /**
   * Heard as written, heard as a different word (whose time it took), or
   * spread over the time around it.
   */
  kind: "exact" | "substituted" | "spread";
}

/**
 * Match heard words to script words (fewest edits) and give every script
 * word a time. Script words the transcription missed share the time around
 * them by length: between their heard neighbours, and, together with a
 * neighbour heard as something else ("four twenty two" heard as "422"), that
 * word's time too. Words after the last one heard run to `takeSeconds`, the
 * take's real length, when it is known. Words with nothing to compare (a
 * dash, an emoji) are timed where the previous word ended.
 */
export function alignTake(
  text: string,
  heard: HeardWord[],
  takeSeconds?: number,
): { words: TimedWord[]; matched: number; total: number } {
  const tokens = [...text.matchAll(/\S+/g)].map((match) => ({
    from: match.index,
    to: match.index + match[0].length,
    key: comparable(match[0]),
  }));
  const scriptWords = tokens.filter((token) => token.key);
  const heardWords = heard
    .map((word) => ({ ...word, key: comparable(word.word) }))
    .filter((word) => word.key);

  // Edit distance over words; a substitution still lends its time, since a
  // misheard word was usually spoken right there.
  const n = scriptWords.length;
  const m = heardWords.length;
  const cost: number[][] = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      cost[i]![j] = Math.min(
        cost[i - 1]![j]! + 1,
        cost[i]![j - 1]! + 1,
        cost[i - 1]![j - 1]! +
          (scriptWords[i - 1]!.key === heardWords[j - 1]!.key ? 0 : 1),
      );
  const times: Array<Timed | null> = Array.from({ length: n }, () => null);
  let matched = 0;
  for (let i = n, j = m; i > 0 && j > 0;) {
    const same = scriptWords[i - 1]!.key === heardWords[j - 1]!.key;
    if (cost[i]![j] === cost[i - 1]![j - 1]! + (same ? 0 : 1)) {
      if (same) matched++;
      const word = heardWords[j - 1]!;
      times[i - 1] = {
        start: word.start,
        end: Math.max(word.start, word.end),
        kind: same ? "exact" : "substituted",
      };
      i--;
      j--;
    } else if (cost[i]![j] === cost[i - 1]![j]! + 1) i--;
    else j--;
  }

  const lastHeard = heardWords.at(-1)?.end ?? 0;
  const length = (index: number) =>
    scriptWords[index]!.to - scriptWords[index]!.from;
  for (let i = 0; i < n;) {
    if (times[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !times[j]) j++;
    // The run [first, last) shares the time from `from` to `to`, taking in a
    // neighbour on either side that was heard as a different word.
    const before = times[i - 1];
    const after = times[j];
    const first = before?.kind === "substituted" ? i - 1 : i;
    const last = after?.kind === "substituted" ? j + 1 : j;
    const from = first < i ? before!.start : (before?.end ?? 0);
    const to =
      last > j
        ? after!.end
        : (after?.start ?? Math.max(from, lastHeard, takeSeconds ?? lastHeard));
    const span = Math.max(0, to - from);
    let characters = 0;
    for (let k = first; k < last; k++) characters += length(k);
    let at = from;
    for (let k = first; k < last; k++) {
      const end = at + (span * length(k)) / characters;
      times[k] = { start: at, end, kind: "spread" };
      at = end;
    }
    i = last;
  }
  // Keep time moving forward even if the transcription wobbles.
  let floor = 0;
  for (const time of times) {
    time!.start = Math.max(time!.start, floor);
    time!.end = Math.max(time!.end, time!.start);
    floor = time!.end;
  }

  let held = 0;
  let next = 0;
  const words = tokens.map(({ from, to, key }) => {
    if (!key) return { from, to, start: held, end: held };
    const time = times[next++]!;
    held = time.end;
    return { from, to, start: time.start, end: time.end };
  });
  return { words, matched, total: n };
}
