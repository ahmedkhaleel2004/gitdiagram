import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExplainerAudio } from "./audio-mixer";
import * as timeStretch from "./time-stretch";
import type { VideoArtifact } from "./types";

// A Web Audio stand-in: a clock the test moves by hand, and buffers that are
// plain sample arrays. JSDOM has no Worker, so stretching runs in place.

const SAMPLE_RATE = 8_000;

class FakeBuffer {
  private data: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length),
    );
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(index: number) {
    return this.data[index]!;
  }
  copyToChannel(source: Float32Array, index: number) {
    this.data[index]!.set(source);
  }
}

interface FakeSource {
  buffer: FakeBuffer | null;
  playbackRate: { value: number };
  connect: (node: unknown) => unknown;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

class FakeContext {
  static last: FakeContext;
  currentTime = 0;
  outputLatency = 0;
  baseLatency = 0;
  state: AudioContextState = "suspended";
  onstatechange: (() => void) | null = null;
  destination = {};
  sources: FakeSource[] = [];
  resumeGate: Promise<void> = Promise.resolve();
  constructor() {
    FakeContext.last = this;
  }
  resume() {
    return this.resumeGate.then(() => {
      this.state = "running";
    });
  }
  suspend = vi.fn(() => {
    this.state = "suspended";
    return Promise.resolve();
  });
  close() {
    return Promise.resolve();
  }
  setState(state: AudioContextState) {
    this.state = state;
    this.onstatechange?.();
  }
  createDynamicsCompressor() {
    return {
      threshold: { value: 0 },
      ratio: { value: 0 },
      connect: (node: unknown) => node,
    };
  }
  createGain() {
    return { gain: { value: 1 }, connect: (node: unknown) => node };
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new FakeBuffer(channels, length, sampleRate);
  }
  createBufferSource() {
    const source: FakeSource = {
      buffer: null,
      playbackRate: { value: 1 },
      connect: (node: unknown) => node,
      start: vi.fn(),
      stop: vi.fn(),
    };
    this.sources.push(source);
    return source;
  }
  async decodeAudioData() {
    // One second of a tone: long enough to stretch, quick to do it.
    const buffer = new FakeBuffer(1, SAMPLE_RATE, SAMPLE_RATE);
    const data = buffer.getChannelData(0);
    for (let n = 0; n < data.length; n++)
      data[n] = Math.sin((2 * Math.PI * 220 * n) / SAMPLE_RATE);
    return buffer;
  }
}

const artifact = {
  meta: { owner: "acme", repo: "demo" },
  createdAt: "2026-09-25T00:00:00.000Z",
  voices: [{ start: 0 }],
} as unknown as VideoArtifact;

async function loaded(holdRate = 2) {
  const mixer = new ExplainerAudio(artifact, [], holdRate);
  await mixer.load();
  return { mixer, context: FakeContext.last };
}

/** The narration source scheduled by the latest play. */
const voiceSource = (context: FakeContext) =>
  context.sources.filter((source) => source.buffer).at(-1)!;

beforeEach(() => {
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ExplainerAudio", () => {
  it("never runs the clock back before the point playback starts from", async () => {
    const { mixer, context } = await loaded();
    context.currentTime = 10;
    await mixer.play(4);
    // Sound starts a moment after the call; the clock holds until then.
    expect(mixer.currentTime()).toBe(4);
    context.currentTime = 10.03;
    expect(mixer.currentTime()).toBe(4);
    context.currentTime = 11.05;
    expect(mixer.currentTime()).toBeCloseTo(5, 5);
  });

  it("holds the picture back by the output latency", async () => {
    const { mixer, context } = await loaded();
    context.outputLatency = 0.2;
    await mixer.play(0);
    context.currentTime = 1.05;
    expect(mixer.currentTime()).toBeCloseTo(0.8, 5);
    expect(mixer.pause()).toBeCloseTo(0.8, 5);
  });

  it("pauses when the system suspends the sound", async () => {
    const { mixer, context } = await loaded();
    const interrupted = vi.fn();
    mixer.onInterrupted = interrupted;
    await mixer.play(0);
    context.currentTime = 2.05;
    context.setState("interrupted" as AudioContextState);
    expect(mixer.isPlaying).toBe(false);
    expect(interrupted).toHaveBeenCalledOnce();
    expect(voiceSource(context).stop).toHaveBeenCalled();
    context.currentTime = 5;
    expect(mixer.currentTime()).toBeCloseTo(2, 5);
  });

  it("starts at a speed chosen while play was still waiting", async () => {
    const { mixer, context } = await loaded();
    let open = () => {};
    context.resumeGate = new Promise((resolve) => (open = resolve));
    const playing = mixer.play(0);
    const speeding = mixer.setRate(1.25);
    await speeding;
    open();
    await playing;
    expect(mixer.isPlaying).toBe(true);
    // The narration scheduled is the 1.25× stretch, and the clock agrees.
    expect(voiceSource(context).buffer!.length).toBe(
      Math.round(SAMPLE_RATE / 1.25),
    );
    context.currentTime += 1;
    expect(mixer.currentTime()).toBeCloseTo(1.25 * (1 - 0.05), 5);
  });

  it("keeps stretched narration for the current and hold speeds only", async () => {
    const stretch = vi.spyOn(timeStretch, "stretchChannels");
    const { mixer } = await loaded(2);
    await mixer.setRate(2);
    await mixer.setRate(1.25);
    await mixer.setRate(1.5);
    expect(stretch).toHaveBeenCalledTimes(3);
    // 2× (the hold speed) was kept; 1.25× was let go.
    await mixer.setRate(2);
    expect(stretch).toHaveBeenCalledTimes(3);
    await mixer.setRate(1.25);
    expect(stretch).toHaveBeenCalledTimes(4);
  });

  it("counts both the base and the output latency", async () => {
    const { mixer, context } = await loaded();
    context.outputLatency = 0.2;
    context.baseLatency = 0.01;
    await mixer.play(0);
    context.currentTime = 1.05;
    expect(mixer.currentTime()).toBeCloseTo(0.79, 5);
  });

  it("never steps the clock back when the output latency grows", async () => {
    const { mixer, context } = await loaded();
    await mixer.play(0);
    context.currentTime = 1.05;
    expect(mixer.currentTime()).toBeCloseTo(1, 5);
    // A Bluetooth device connects mid-play.
    context.outputLatency = 0.3;
    context.currentTime = 1.15;
    expect(mixer.currentTime()).toBeCloseTo(1, 5);
    context.currentTime = 1.55;
    expect(mixer.currentTime()).toBeCloseTo(1.2, 5);
  });

  it("reports that a play a pause replaced never started", async () => {
    const { mixer, context } = await loaded();
    let open = () => {};
    context.resumeGate = new Promise((resolve) => (open = resolve));
    const playing = mixer.play(0);
    mixer.pause();
    open();
    expect(await playing).toBe(false);
    expect(mixer.isPlaying).toBe(false);
    expect(context.sources).toHaveLength(0);
  });

  it("starts a waiting play where a seek moved it", async () => {
    const { mixer, context } = await loaded();
    let open = () => {};
    context.resumeGate = new Promise((resolve) => (open = resolve));
    const playing = mixer.play(0);
    mixer.seek(0.5);
    open();
    expect(await playing).toBe(true);
    expect(voiceSource(context).start).toHaveBeenCalledWith(0.05, 0.5);
    expect(mixer.currentTime()).toBe(0.5);
  });

  it("lets the audio device go while paused", async () => {
    const { mixer, context } = await loaded();
    expect(await mixer.play(0)).toBe(true);
    mixer.pause();
    expect(context.suspend).toHaveBeenCalledOnce();
  });

  it("reports sound that cannot resume to the caller", async () => {
    const { mixer, context } = await loaded();
    context.resumeGate = Promise.reject(new Error("not allowed"));
    await expect(mixer.play(0)).rejects.toThrow("not allowed");
    expect(mixer.isPlaying).toBe(false);
  });

  it("stops stretching once disposed", async () => {
    const stretch = vi.spyOn(timeStretch, "stretchChannels");
    const { mixer, context } = await loaded();
    const createBuffer = vi.spyOn(context, "createBuffer");
    const speeding = mixer.setRate(1.5);
    mixer.dispose();
    await speeding;
    expect(stretch).not.toHaveBeenCalled();
    expect(createBuffer).not.toHaveBeenCalled();
  });

  it("stops a play waiting on the stretch worker once disposed", async () => {
    // A worker that answers (unstretched) until told to stop answering.
    let answering = true;
    const workers: Array<{ terminate: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal(
      "Worker",
      class {
        onmessage: ((event: { data: unknown }) => void) | null = null;
        onerror = null;
        terminate = vi.fn();
        constructor() {
          workers.push(this);
        }
        postMessage(data: { id: number; channels: Float32Array[] }) {
          if (answering)
            queueMicrotask(() =>
              this.onmessage?.({
                data: { id: data.id, channels: data.channels },
              }),
            );
        }
      },
    );
    const { mixer, context } = await loaded();
    await mixer.setRate(1.5);
    answering = false;
    const createBuffer = vi.spyOn(context, "createBuffer");
    // 1.25× lets the 1.5× narration go, so the play must stretch it again.
    const speeding = mixer.setRate(1.25);
    const playing = mixer.play(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    mixer.dispose();
    await speeding;
    expect(await playing).toBe(false);
    expect(workers[0]!.terminate).toHaveBeenCalled();
    expect(createBuffer).not.toHaveBeenCalled();
    expect(mixer.isPlaying).toBe(false);
  });
});
