// Changes how fast speech plays without changing its pitch (WSOLA). The clip
// is cut into short overlapping windows and laid back down at a different
// spacing; each window is nudged to line up with the waveform already
// written, so the voice keeps its tone instead of warbling.

/** Periodic Hann: at half overlap the windows sum to exactly one. */
function hann(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let n = 0; n < size; n++)
    window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / size);
  return window;
}

/** How alike two stretches of the signal are, sampling every `stride`. */
function similarity(
  signal: Float32Array,
  a: number,
  b: number,
  length: number,
  stride: number,
): number {
  let sum = 0;
  for (let n = 0; n < length; n += stride)
    sum += signal[a + n]! * signal[b + n]!;
  return sum;
}

/**
 * The start near `target` whose opening best continues the waveform at
 * `natural`: a coarse pass over the whole range, then a fine pass around
 * the best coarse match.
 */
function align(
  signal: Float32Array,
  natural: number,
  target: number,
  tolerance: number,
  length: number,
  last: number,
): number {
  if (natural + length > signal.length) return target;
  const low = Math.max(0, target - tolerance);
  const high = Math.min(last, target + tolerance);
  let best = target;
  let bestScore = -Infinity;
  for (let start = low; start <= high; start += 4) {
    const score = similarity(signal, natural, start, length, 4);
    if (score > bestScore) [best, bestScore] = [start, score];
  }
  const coarse = best;
  for (
    let start = Math.max(low, coarse - 4);
    start <= Math.min(high, coarse + 4);
    start++
  ) {
    const score = similarity(signal, natural, start, length, 2);
    if (score > bestScore) [best, bestScore] = [start, score];
  }
  return best;
}

/**
 * Plays `channels` `rate` times as fast (2 halves the length) at the same
 * pitch. Every channel shares one alignment, so stereo stays in phase.
 */
export function stretchChannels(
  channels: Float32Array[],
  sampleRate: number,
  rate: number,
): Float32Array<ArrayBuffer>[] {
  const first = channels[0];
  if (!first || rate === 1) return channels.map((channel) => channel.slice());
  const inputLength = first.length;
  const outputLength = Math.max(1, Math.round(inputLength / rate));
  // About 25 ms windows: long enough to hold a voice's pitch period.
  const size = 2 ** Math.round(Math.log2(sampleRate * 0.025));
  const hop = size / 2;
  if (inputLength < size * 2) {
    // Too short to window; a blip this short has no pitch to keep.
    return channels.map((channel) => {
      const output = new Float32Array(outputLength);
      for (let n = 0; n < outputLength; n++)
        output[n] = channel[Math.min(inputLength - 1, Math.floor(n * rate))]!;
      return output;
    });
  }

  const guide =
    channels.length === 1
      ? first
      : first.map(
          (_, n) =>
            channels.reduce((sum, channel) => sum + channel[n]!, 0) /
            channels.length,
        );
  const window = hann(size);
  const outputs = channels.map(() => new Float32Array(outputLength + size));
  const last = inputLength - size;
  let previous = 0;
  for (let at = 0; at < outputLength; at += hop) {
    const target = Math.min(last, Math.round(at * rate));
    const start =
      at === 0 ? 0 : align(guide, previous + hop, target, hop / 2, hop, last);
    channels.forEach((channel, c) => {
      const output = outputs[c]!;
      for (let n = 0; n < size; n++)
        output[at + n]! += window[n]! * channel[start + n]!;
    });
    previous = start;
  }
  return outputs.map((output) => output.slice(0, outputLength));
}
