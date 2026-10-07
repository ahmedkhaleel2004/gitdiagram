// Compares every service's heard words on the same takes, through the repo's
// real code: alignTake (voice-alignment.ts) and narrateBeats (narration.ts,
// loaded unchanged with voice.ts swapped for voice-stub.ts).
//   bun experiments/video-whisper-workers-ai/analyze.ts
import { plugin, $ } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  cached,
  DATA,
  HERE,
  median,
  percentile,
  readJson,
  writeJson,
  type Heard,
  type Sample,
} from "./lib";
import { PROVIDERS, type Transcript } from "./providers";

plugin({
  name: "narration-without-the-voice",
  setup(build) {
    build.module("server-only", () => ({ exports: {}, loader: "object" }));
    build.onLoad({ filter: /src\/server\/explainer\/voice\.ts$/ }, () => ({
      contents: `export * from ${JSON.stringify(join(HERE, "voice-stub.ts"))};`,
      loader: "ts",
    }));
  },
});
const { narrateBeats } = await import("../../src/server/explainer/narration");
const { current } = await import("./voice-stub");

type Timing = Sample["stored"];
const samples = readJson<Sample[]>(join(DATA, "samples.json"));

/** The comparison voice-alignment.ts makes (its `comparable`, not exported). */
const comparable = (word: string) =>
  word
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

/** Word edits (substituted, missed, added) between script and heard. */
function wordErrors(script: string[], heard: string[]) {
  const n = script.length;
  const m = heard.length;
  let previous = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const row = [i];
    for (let j = 1; j <= m; j++)
      row[j] = Math.min(
        previous[j]! + 1,
        row[j - 1]! + 1,
        previous[j - 1]! + (script[i - 1] === heard[j - 1] ? 0 : 1),
      );
    previous = row;
  }
  return previous[m]!;
}

/** Pauses in the take: silence below -35 dB for at least 0.2 s (ffmpeg). */
const silences = (sample: Sample) =>
  cached(join(DATA, `${sample.slug}.silence.json`), async () => {
    const log =
      await $`ffmpeg -hide_banner -nostats -i ${sample.mp3} -af silencedetect=noise=-35dB:d=0.2 -f null -`
        .quiet()
        .nothrow();
    const text = log.stderr.toString();
    const starts = [...text.matchAll(/silence_start: ([\d.]+)/g)].map((m) =>
      Number(m[1]),
    );
    const ends = [...text.matchAll(/silence_end: ([\d.]+)/g)].map((m) =>
      Number(m[1]),
    );
    return starts
      .map((start, i) => ({ start, end: ends[i] ?? NaN }))
      .filter((s) => Number.isFinite(s.end));
  });

const LEAD_IN = 0.4;

interface Measured {
  timing: Timing;
  matched: number;
  total: number;
  accepted: boolean;
  wer: number;
  ms: number;
  heardWords: number;
}

async function measure(sample: Sample, heard: Transcript): Promise<Measured> {
  current.heard = heard.words;
  current.seconds = sample.seconds;
  const narration = await narrateBeats(sample.beats);
  const last = current.last!;
  const script = [...last.text.matchAll(/\S+/g)]
    .map((m) => comparable(m[0]))
    .filter(Boolean);
  const said = heard.words.map((w) => comparable(w.word)).filter(Boolean);
  return {
    timing: narration.timing,
    matched: last.matched,
    total: last.total,
    accepted: last.accepted,
    wer: wordErrors(script, said) / script.length,
    ms: heard.ms,
    heardWords: said.length,
  };
}

const flatWords = (timing: Timing) => timing.beats.flatMap((b) => b.words);

const load = (sample: Sample, name: string, run: string) => {
  const file = join(DATA, "heard", `${sample.slug}.${name}.${run}.json`);
  return existsSync(file) ? readJson<Transcript>(file) : null;
};

interface Row {
  name: string;
  label: string;
  takes: number;
  minutes: number;
  wer: number[];
  matchedShare: number[];
  refused: number;
  ms: number[];
  wordStart: number[];
  wordEnd: number[];
  beatStart: number[];
  beatEnd: number[];
  sceneStart: number[];
  afterPause: number[]; // word start vs reference, words that follow a pause
  midPhrase: number[]; // the same for every other word
  pauseEnd: number[]; // word end against where the pause really starts
  pauseStart: number[]; // next word start against where the pause really ends
  worst: Array<{ slug: string; what: string; ms: number; word: string }>;
}

const row = (name: string, label: string): Row => ({
  name,
  label,
  takes: 0,
  minutes: 0,
  wer: [],
  matchedShare: [],
  refused: 0,
  ms: [],
  wordStart: [],
  wordEnd: [],
  beatStart: [],
  beatEnd: [],
  sceneStart: [],
  afterPause: [],
  midPhrase: [],
  pauseEnd: [],
  pauseStart: [],
  worst: [],
});

/** Signed differences (seconds) of `timing` from `reference`, into `into`. */
function compare(
  sample: Sample,
  timing: Timing,
  reference: Timing,
  into: Row,
  pauses: Array<{ start: number; end: number }> = [],
) {
  const a = flatWords(timing);
  const b = flatWords(reference);
  // Words the reference starts within 0.3 s of a pause's end.
  const follows = b.map((word) =>
    pauses.some((p) => Math.abs(word.s - (LEAD_IN + p.end)) < 0.3),
  );
  if (a.length !== b.length)
    throw new Error(
      `${sample.slug}: word counts differ ${a.length}/${b.length}`,
    );
  a.forEach((word, i) => {
    into.wordStart.push(word.s - b[i]!.s);
    (follows[i] ? into.afterPause : into.midPhrase).push(word.s - b[i]!.s);
    into.wordEnd.push(word.e - b[i]!.e);
    const worst = Math.max(
      Math.abs(word.s - b[i]!.s),
      Math.abs(word.e - b[i]!.e),
    );
    if (worst > 0.25)
      into.worst.push({
        slug: sample.slug,
        what: "word",
        ms: Math.round(worst * 1000),
        word: word.w,
      });
  });
  timing.beats.forEach((beat, i) => {
    const other = reference.beats[i]!;
    into.beatStart.push(beat.start - other.start);
    into.beatEnd.push(beat.end - other.end);
    if (i > 0 && sample.beats[i]!.scene !== sample.beats[i - 1]!.scene)
      into.sceneStart.push(beat.start - other.start);
  });
}

/**
 * Against the audio itself: at each real pause, the word before it should end
 * where the silence starts and the word after should start where it ends.
 */
function comparePauses(
  timing: Timing,
  pauses: Array<{ start: number; end: number }>,
  into: Row,
) {
  const words = flatWords(timing);
  for (const pause of pauses) {
    const middle = LEAD_IN + (pause.start + pause.end) / 2;
    let before = -1;
    for (let i = 0; i < words.length - 1; i++) {
      const left = (words[i]!.s + words[i]!.e) / 2;
      const right = (words[i + 1]!.s + words[i + 1]!.e) / 2;
      if (left <= middle && middle <= right) before = i;
    }
    if (before < 0) continue;
    into.pauseEnd.push(words[before]!.e - (LEAD_IN + pause.start));
    into.pauseStart.push(words[before + 1]!.s - (LEAD_IN + pause.end));
  }
}

const rows: Row[] = [];
const perTake: unknown[] = [];
const variants: Array<[string, string]> = [
  ["whisper-1", "b"],
  ["turbo", "a"],
  ["turbo", "b"],
  ["turbo-vad", "a"],
  ["turbo-en", "a"],
  ["whisper", "a"],
  ["whisper", "b"],
  ["tiny-en", "a"],
  ["nova-3", "a"],
  ["nova-3", "b"],
];

// The reference is whisper-1 heard today (run a) through today's code.
const reference = row(
  "whisper-1.a",
  `${PROVIDERS["whisper-1"]!.label}, run a (the reference)`,
);
const stored = row(
  "stored",
  "Timing stored in production, against today's whisper-1 run",
);
const selfConsistency: Record<string, Row> = {};
rows.push(reference, stored);
for (const [name, run] of variants)
  rows.push(row(`${name}.${run}`, `${PROVIDERS[name]!.label}, run ${run}`));

for (const sample of samples) {
  const pauses = await silences(sample);
  const base = await measure(sample, load(sample, "whisper-1", "a")!);
  const record = (into: Row, m: Measured) => {
    into.takes++;
    into.minutes += sample.seconds / 60;
    into.wer.push(m.wer);
    into.matchedShare.push(m.matched / m.total);
    if (!m.accepted) into.refused++;
    into.ms.push(m.ms);
  };
  record(reference, base);
  comparePauses(base.timing, pauses, reference);
  compare(sample, sample.stored, base.timing, stored);
  comparePauses(sample.stored, pauses, stored);
  stored.takes++;

  const take: Record<string, unknown> = {
    slug: sample.slug,
    seconds: sample.seconds,
    beats: sample.beats.length,
    scriptWords: base.total,
    pauses: pauses.length,
    "whisper-1.a": { matched: base.matched, wer: base.wer, ms: base.ms },
  };
  const timings: Record<string, Timing> = {};
  for (const [name, run] of variants) {
    const heard = load(sample, name, run);
    if (!heard) continue;
    const into = rows.find((r) => r.name === `${name}.${run}`)!;
    const m = await measure(sample, heard);
    timings[`${name}.${run}`] = m.timing;
    record(into, m);
    compare(sample, m.timing, base.timing, into, pauses);
    comparePauses(m.timing, pauses, into);
    take[`${name}.${run}`] = {
      matched: m.matched,
      wer: m.wer,
      ms: m.ms,
      accepted: m.accepted,
    };
  }
  // How much a service differs from itself between two runs.
  for (const name of ["turbo", "whisper", "nova-3"]) {
    const a = timings[`${name}.a`];
    const b = timings[`${name}.b`];
    if (!a || !b) continue;
    const into = (selfConsistency[name] ??= row(
      `${name}.b-vs-a`,
      `${PROVIDERS[name]!.label}: run b against its own run a`,
    ));
    into.takes++;
    compare(sample, b, a, into);
  }
  perTake.push(take);
}
rows.push(...Object.values(selfConsistency));

const abs = (values: number[]) => values.map(Math.abs);
const msOf = (seconds: number) =>
  Number.isNaN(seconds) ? "-" : String(Math.round(seconds * 1000));
const stats = (values: number[]) =>
  values.length
    ? `${msOf(median(abs(values)))} / ${msOf(percentile(abs(values), 0.95))} / ${msOf(Math.max(...abs(values)))}`
    : "-";
const share = (values: number[], over: number) =>
  values.length
    ? `${((100 * values.filter((v) => Math.abs(v) > over).length) / values.length).toFixed(1)}%`
    : "-";
const mean = (values: number[]) =>
  values.reduce((sum, v) => sum + v, 0) / (values.length || 1);

const summary = rows.map((r) => ({
  name: r.name,
  label: r.label,
  takes: r.takes,
  werMean: r.wer.length ? mean(r.wer) : null,
  werWorst: r.wer.length ? Math.max(...r.wer) : null,
  matchedMean: r.matchedShare.length ? mean(r.matchedShare) : null,
  matchedWorst: r.matchedShare.length ? Math.min(...r.matchedShare) : null,
  refused: r.refused,
  latencyMedianMs: r.ms.length ? median(r.ms) : null,
  latencyMaxMs: r.ms.length ? Math.max(...r.ms) : null,
  wordStart: stats(r.wordStart),
  wordEnd: stats(r.wordEnd),
  wordsOver100ms: share([...r.wordStart, ...r.wordEnd], 0.1),
  wordsOver250ms: share([...r.wordStart, ...r.wordEnd], 0.25),
  beatStart: stats(r.beatStart),
  beatEnd: stats(r.beatEnd),
  beatsOver100ms: share([...r.beatStart, ...r.beatEnd], 0.1),
  beatsOver250ms: share([...r.beatStart, ...r.beatEnd], 0.25),
  beatStartBias: msOf(mean(r.beatStart)),
  beatEndBias: msOf(mean(r.beatEnd)),
  sceneStart: stats(r.sceneStart),
  afterPause: stats(r.afterPause),
  afterPauseBias: msOf(median(r.afterPause)),
  afterPauseCount: r.afterPause.length,
  midPhrase: stats(r.midPhrase),
  midPhraseBias: msOf(median(r.midPhrase)),
  midPhraseCount: r.midPhrase.length,
  pauseEnd: stats(r.pauseEnd),
  pauseEndBias: msOf(median(r.pauseEnd)),
  pauseStart: stats(r.pauseStart),
  pauseStartBias: msOf(median(r.pauseStart)),
  pauses: r.pauseEnd.length,
  worst: r.worst.sort((a, b) => b.ms - a.ms).slice(0, 8),
}));
writeJson(join(HERE, "results.json"), { summary, perTake });

const table = (columns: string[], lines: string[][]) =>
  [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...lines.map((line) => `| ${line.join(" | ")} |`),
  ].join("\n");
const pct = (v: number | null) =>
  v === null ? "-" : `${(100 * v).toFixed(1)}%`;

console.log("\nHearing the script (12 takes) and speed\n");
console.log(
  table(
    [
      "service",
      "word error rate mean / worst take",
      "script words heard exactly mean / worst",
      "takes voice.ts would refuse (<75%)",
      "latency median / max ms",
    ],
    summary
      .filter((s) => s.werMean !== null)
      .map((s) => [
        s.name,
        `${pct(s.werMean)} / ${pct(s.werWorst)}`,
        `${pct(s.matchedMean)} / ${pct(s.matchedWorst)}`,
        String(s.refused),
        `${s.latencyMedianMs} / ${s.latencyMaxMs}`,
      ]),
  ),
);
console.log(
  "\nTimes against today's whisper-1 run, ms: median / 95th percentile / worst\n",
);
console.log(
  table(
    [
      "service",
      "word start",
      "word end",
      "words >100 ms",
      "words >250 ms",
      "beat start",
      "beat end",
      "beat edges >100 ms",
      ">250 ms",
      "scene start",
    ],
    summary
      .filter((s) => s.name !== "whisper-1.a")
      .map((s) => [
        s.name,
        s.wordStart,
        s.wordEnd,
        s.wordsOver100ms,
        s.wordsOver250ms,
        s.beatStart,
        s.beatEnd,
        s.beatsOver100ms,
        s.beatsOver250ms,
        s.sceneStart,
      ]),
  ),
);
console.log(
  "\nWord starts against today's whisper-1 run, split by where the word sits, ms\n",
);
console.log(
  table(
    [
      "service",
      "words after a pause",
      "median / p95 / worst",
      "median signed",
      "other words",
      "median / p95 / worst",
      "median signed",
    ],
    summary
      .filter((s) => s.afterPauseCount)
      .map((s) => [
        s.name,
        String(s.afterPauseCount),
        s.afterPause,
        s.afterPauseBias,
        String(s.midPhraseCount),
        s.midPhrase,
        s.midPhraseBias,
      ]),
  ),
);
console.log(
  "\nTimes against the audio's own pauses (ffmpeg silencedetect), ms\n",
);
console.log(
  table(
    [
      "service",
      "pauses",
      "word before: end vs pause start, median / p95 / worst",
      "its median signed",
      "word after: start vs pause end, median / p95 / worst",
      "its median signed",
    ],
    summary
      .filter((s) => s.pauses)
      .map((s) => [
        s.name,
        String(s.pauses),
        s.pauseEnd,
        s.pauseEndBias,
        s.pauseStart,
        s.pauseStartBias,
      ]),
  ),
);
for (const s of summary)
  if (s.worst.length)
    console.log(
      `\nworst words, ${s.name}: ${s.worst.map((w) => `${w.word} ${w.ms}ms (${w.slug})`).join("; ")}`,
    );
