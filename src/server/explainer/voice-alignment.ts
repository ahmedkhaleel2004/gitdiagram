// Timing for the take (voice.ts): a transcription gives words with times,
// and these are matched back onto the script as a character-level
// alignment, which narration.ts splits into beats.

/** When each character of the script text starts and ends in the take. */
export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface HeardWord {
  word: string;
  start: number;
  end: number;
}

const comparable = (word: string) =>
  word.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Match heard words to script words (fewest edits), give every script word a
 * time (unmatched ones share the gap between their matched neighbours), then
 * spread each word's time over its characters. Characters outside words
 * (spaces, punctuation between words, delivery tags) hold the time where the
 * previous word ended.
 */
export function alignTake(
  text: string,
  heard: HeardWord[],
): Alignment & { matched: number; words: number } {
  const scriptWords: Array<{ from: number; to: number; key: string }> = [];
  for (const match of text.matchAll(/\[[^\]]*\]|[^\s[]+/g)) {
    if (match[0].startsWith("[")) continue;
    const key = comparable(match[0]);
    if (key)
      scriptWords.push({
        from: match.index,
        to: match.index + match[0].length,
        key,
      });
  }
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
  const times: Array<{ start: number; end: number } | null> = Array.from(
    { length: n },
    () => null,
  );
  let matched = 0;
  for (let i = n, j = m; i > 0 && j > 0;) {
    const same = scriptWords[i - 1]!.key === heardWords[j - 1]!.key;
    if (cost[i]![j] === cost[i - 1]![j - 1]! + (same ? 0 : 1)) {
      if (same) matched++;
      const word = heardWords[j - 1]!;
      times[i - 1] = { start: word.start, end: Math.max(word.start, word.end) };
      i--;
      j--;
    } else if (cost[i]![j] === cost[i - 1]![j]! + 1) i--;
    else j--;
  }

  // Unmatched words split the time between their matched neighbours.
  const lastEnd = heardWords.at(-1)?.end ?? 0;
  for (let i = 0; i < n;) {
    if (times[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !times[j]) j++;
    const from = times[i - 1]?.end ?? 0;
    const to = times[j]?.start ?? Math.max(from, lastEnd);
    const step = (Math.max(from, to) - from) / (j - i);
    for (let k = i; k < j; k++)
      times[k] = {
        start: from + step * (k - i),
        end: from + step * (k - i + 1),
      };
    i = j;
  }
  // Keep time moving forward even if the transcription wobbles.
  let floor = 0;
  for (const time of times) {
    time!.start = Math.max(time!.start, floor);
    time!.end = Math.max(time!.end, time!.start);
    floor = time!.end;
  }

  const characters = text.split("");
  const starts = new Array<number>(characters.length);
  const ends = new Array<number>(characters.length);
  let held = 0;
  let word = 0;
  for (let index = 0; index < characters.length; index++) {
    while (word < n && scriptWords[word]!.to <= index) word++;
    const current = scriptWords[word];
    if (current && index >= current.from && index < current.to) {
      const time = times[word]!;
      const length = current.to - current.from;
      const share = (time.end - time.start) / length;
      starts[index] = time.start + share * (index - current.from);
      ends[index] = time.start + share * (index - current.from + 1);
      held = time.end;
    } else {
      starts[index] = held;
      ends[index] = held;
    }
  }
  return {
    characters,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
    matched,
    words: n,
  };
}
