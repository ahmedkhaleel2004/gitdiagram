// Stands in for src/server/explainer/voice.ts when the real narration.ts is
// loaded by analyze.ts: `speak` returns the take already downloaded, timed by
// the repo's real alignTake from whichever service's heard words are set.
// The acceptance rule is the one in voice.ts (MIN_MATCHED = 0.75).
import {
  alignTake,
  type HeardWord,
} from "../../src/server/explainer/voice-alignment";

export const MIN_MATCHED = 0.75;

export const current: {
  heard: HeardWord[];
  seconds: number;
  last?: { matched: number; total: number; accepted: boolean; text: string };
} = { heard: [], seconds: 0 };

export class VoiceUnavailableError extends Error {}
export const voicePausedUntil = async () => null;

export async function speak(text: string) {
  const alignment = alignTake(text, current.heard, current.seconds);
  const accepted =
    alignment.total > 0 && alignment.matched / alignment.total >= MIN_MATCHED;
  current.last = {
    matched: alignment.matched,
    total: alignment.total,
    accepted,
    text,
  };
  return {
    audio: Buffer.alloc(0),
    seconds: current.seconds,
    voice: "stub",
    costUsd: 0,
    // voice.ts reads the script again when a take is not accepted; here the
    // refusal is recorded and the words are still returned for measuring.
    words: alignment.words,
  };
}
