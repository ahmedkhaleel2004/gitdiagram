import { describe, expect, it, vi } from "vitest";
import { stretchChannels } from "./time-stretch";

const SAMPLE_RATE = 44_100;

function tone(frequency: number, seconds: number): Float32Array {
  const samples = new Float32Array(Math.round(SAMPLE_RATE * seconds));
  for (let n = 0; n < samples.length; n++)
    samples[n] = 0.5 * Math.sin((2 * Math.PI * frequency * n) / SAMPLE_RATE);
  return samples;
}

/** Pitch from upward zero crossings, away from the faded ends. */
function pitch(samples: Float32Array): number {
  const start = Math.floor(samples.length * 0.2);
  const end = Math.floor(samples.length * 0.8);
  let crossings = 0;
  for (let n = start + 1; n < end; n++)
    if (samples[n - 1]! < 0 && samples[n]! >= 0) crossings++;
  return crossings / ((end - start) / SAMPLE_RATE);
}

describe("stretchChannels", () => {
  it.each([0.75, 1.25, 1.5, 2])(
    "plays %sx as fast at the same pitch",
    (rate) => {
      const [output] = stretchChannels([tone(220, 2)], SAMPLE_RATE, rate);
      expect(output!.length).toBe(Math.round((SAMPLE_RATE * 2) / rate));
      expect(pitch(output!)).toBeGreaterThan(215);
      expect(pitch(output!)).toBeLessThan(225);
    },
  );

  it("keeps the level steady instead of pumping", () => {
    const [output] = stretchChannels([tone(220, 2)], SAMPLE_RATE, 2);
    const middle = output!.subarray(
      Math.floor(output!.length * 0.2),
      Math.floor(output!.length * 0.8),
    );
    const peak = middle.reduce((max, value) => Math.max(max, value), 0);
    expect(peak).toBeGreaterThan(0.45);
    expect(peak).toBeLessThan(0.55);
  });

  it("keeps stereo channels the same length and in step", () => {
    const left = tone(220, 1);
    const [a, b] = stretchChannels([left, left.slice()], SAMPLE_RATE, 1.5);
    expect(a!.length).toBe(b!.length);
    expect(Array.from(a!.subarray(1000, 1010))).toEqual(
      Array.from(b!.subarray(1000, 1010)),
    );
  });

  it("returns copies at normal speed and handles clips too short to window", () => {
    const input = tone(220, 0.5);
    const [same] = stretchChannels([input], SAMPLE_RATE, 1);
    expect(same).not.toBe(input);
    expect(Array.from(same!)).toEqual(Array.from(input));
    const [blip] = stretchChannels([tone(220, 0.01)], SAMPLE_RATE, 2);
    expect(blip!.length).toBe(Math.round(441 / 2));
  });

  it("stretches in a worker and hands the samples back without copying", async () => {
    const scope: {
      onmessage: ((event: { data: unknown }) => void) | null;
      postMessage: ReturnType<typeof vi.fn>;
    } = { onmessage: null, postMessage: vi.fn() };
    vi.stubGlobal("self", scope);
    await import("./time-stretch.worker");
    vi.unstubAllGlobals();
    scope.onmessage!({
      data: {
        id: 7,
        channels: [tone(220, 0.5)],
        sampleRate: SAMPLE_RATE,
        rate: 2,
      },
    });
    const [message, transfer] = scope.postMessage.mock.calls[0]!;
    expect(message.id).toBe(7);
    expect(message.channels[0].length).toBe(
      Math.round((SAMPLE_RATE * 0.5) / 2),
    );
    expect(transfer).toEqual([message.channels[0].buffer]);
  });
});
