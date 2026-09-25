import { spawnSync } from "node:child_process";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readVoiceClip: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("./store", () => ({ readVoiceClip: mocks.readVoiceClip }));

import ffmpegStatic from "ffmpeg-static";
import type { SfxCue } from "~/features/explainer/audio-mixer";
import type { VideoArtifact } from "~/features/explainer/types";
import { mixSoundtrack, soundtrackGraph, untilAborted } from "./ffmpeg";

const ffmpeg = ffmpegStatic as unknown as string;

/** A short tone as MP3, standing in for narration and effect sounds. */
const tone = (seconds: number) =>
  spawnSync(ffmpeg, [
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:duration=${seconds}`,
    "-f",
    "mp3",
    "pipe:1",
  ]).stdout;

const artifact = (duration: number) =>
  ({
    meta: { owner: "acme", repo: "widget" },
    createdAt: "2026-09-24T08:06:45.297Z",
    voices: [{ start: 0 }, { start: 1 }],
    timing: { DURATION: duration },
  }) as unknown as VideoArtifact;

const cue = (name: string, t: number, rate?: number): SfxCue => ({
  name,
  t,
  gain: 0,
  ...(rate ? { rate } : {}),
});

let voice: Buffer;
let effect: Buffer;
beforeAll(() => {
  voice = tone(1);
  effect = tone(0.2);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the soundtrack filter graph", () => {
  it("decodes each effect sound once and splits it per cue", () => {
    const { inputs, graph } = soundtrackGraph({
      voices: [
        { path: "v0.mp3", start: 0 },
        { path: "v1.mp3", start: 2.5 },
      ],
      effects: new Map([
        ["pop", "pop.mp3"],
        ["tick", "tick.mp3"],
      ]),
      cues: [
        cue("pop", 1),
        cue("tick", 1.5),
        cue("pop", 2, 1.1),
        cue("whoosh", 3), // no sound for it: skipped
        cue("pop", 4),
      ],
      duration: 10,
    });
    expect(inputs).toEqual(["v0.mp3", "v1.mp3", "pop.mp3", "tick.mp3"]);
    const chains = graph.split(";");
    expect(chains).toContain("[2:a]aresample=44100,asplit=3[e2_0][e2_1][e2_2]");
    expect(chains).toContain("[3:a]aresample=44100,asplit=1[e3_0]");
    expect(graph).toContain("adelay=2500|2500");
    expect(graph).toContain(`asetrate=${Math.round(44100 * 1.1)}`);
    // Two voices and four placed cues go into the mix.
    expect(graph).toMatch(
      /\[a0\]\[a1\]\[a2\]\[a3\]\[a4\]\[a5\]amix=inputs=6:normalize=0/,
    );
    expect(graph).toMatch(/atrim=0:10\.000\[mix\]$/);
  });
});

describe("mixing the soundtrack", () => {
  it("mixes with real ffmpeg, fetching only known effect sounds once each", async () => {
    mocks.readVoiceClip.mockResolvedValue(voice);
    const fetchMock = vi.fn(
      async (_url: string) => new Response(new Uint8Array(effect)),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await mixSoundtrack({
      artifact: artifact(2),
      sfx: [
        cue("pop", 0.2),
        cue("pop", 0.6, 1.2),
        cue("tick", 1),
        cue("constructor", 1.2),
        cue("toString", 1.4),
      ],
      origin: "https://example.com",
    });
    expect(out.byteLength).toBeGreaterThan(1000);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://example.com/video-engine/assets/sfx/pop.mp3",
      "https://example.com/video-engine/assets/sfx/tick.mp3",
    ]);
  });

  it("stops ffmpeg when the deadline passes", async () => {
    mocks.readVoiceClip.mockResolvedValue(voice);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(effect))),
    );
    const deadline = new AbortController();
    // A long film, so loudness normalization runs for many seconds.
    const mixing = mixSoundtrack({
      artifact: artifact(4000),
      sfx: [cue("pop", 0.2)],
      origin: "https://example.com",
      signal: deadline.signal,
    });
    const started = Date.now();
    setTimeout(() => deadline.abort(new Error("out of time")), 300);
    await expect(mixing).rejects.toThrow("out of time");
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe("untilAborted", () => {
  it("rejects a pending promise when its signal aborts", async () => {
    const controller = new AbortController();
    const waiting = untilAborted(
      new Promise(() => undefined),
      controller.signal,
    );
    controller.abort(new Error("gone"));
    await expect(waiting).rejects.toThrow("gone");
    await expect(untilAborted(Promise.resolve(1), undefined)).resolves.toBe(1);
  });
});
