import { spawnSync } from "node:child_process";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readVoiceClip: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("./store", () => ({ readVoiceClip: mocks.readVoiceClip }));

import ffmpegStatic from "ffmpeg-static";
import type { SfxCue } from "~/features/explainer/audio-mixer";
import { ENGINE_VERSION } from "~/features/explainer/engine";
import type { VideoArtifact } from "~/features/explainer/types";
import type { TimeEdit } from "./feed-edit";
import {
  mixSoundtrack,
  segmentRanges,
  soundtrackGraph,
  untilAborted,
  videoCodecArgs,
  voiceSilences,
} from "./ffmpeg";

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
      `https://example.com/video-engine/assets/sfx/pop.mp3?v=${ENGINE_VERSION}`,
      `https://example.com/video-engine/assets/sfx/tick.mp3?v=${ENGINE_VERSION}`,
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

/** A sound's length in seconds, read from ffmpeg's report on it. */
function lengthOf(file: Buffer): number {
  const report = spawnSync(ffmpeg, ["-hide_banner", "-i", "pipe:0"], {
    input: file,
  }).stderr.toString();
  const [, h, m, sec] = /Duration: (\d+):(\d+):([\d.]+)/.exec(report)!;
  return Number(h) * 3600 + Number(m) * 60 + Number(sec);
}

describe("the vertical MP4's feed cut", () => {
  const edit: TimeEdit = [
    [0.5, 2, 1.5],
    [2, 4, 0.3],
    [4, 5.5, 1.5],
  ];

  it("places only the narration the cut keeps, on the cut's clock", () => {
    const { inputs, graph } = soundtrackGraph({
      voices: [{ path: "v0.mp3", start: 0.4 }],
      effects: new Map([["pop", "pop.mp3"]]),
      cues: [cue("pop", 0.2), cue("pop", 3), cue("pop", 4.5), cue("pop", 9)],
      duration: 12,
      edit,
    });
    expect(inputs).toEqual(["v0.mp3", "pop.mp3"]);
    // The take is laid out on the film's clock, then cut in two around the
    // shortened pause: its first and last 0.15 s are kept.
    expect(graph).toContain(
      "[0:a]aresample=48000,aformat=channel_layouts=stereo,adelay=400|400[v0]",
    );
    expect(graph).toContain("asplit=2[p0][p1]");
    expect(graph).toContain("[p0]atrim=start=0.500:end=2.150");
    expect(graph).toContain("[p1]atrim=start=3.850:end=5.500");
    expect(graph).toMatch(/\[p1\]atrim=[^;]*adelay=1650\|1650/);
    // Hits move with their moment (3 s is mid-pause: 1.5 + 0.15), and those
    // outside the cut are left out.
    expect(graph).toContain("[1:a]aresample=44100,asplit=2[e1_0][e1_1]");
    expect(graph).toContain("adelay=1650|1650,volume=");
    expect(graph).toContain("adelay=2300|2300,volume=");
    expect(graph).toMatch(/atrim=0:3\.300\[mix\]$/);
  });

  it("mixes a soundtrack exactly as long as the cut", async () => {
    mocks.readVoiceClip.mockResolvedValue(tone(6));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(effect))),
    );
    const out = await mixSoundtrack({
      artifact: { ...artifact(8), voices: [{ start: 0 }] } as VideoArtifact,
      sfx: [cue("pop", 1), cue("pop", 3.5)],
      origin: "https://example.com",
      edit,
    });
    expect(lengthOf(out)).toBeCloseTo(3.3, 1);
  });

  it("finds the pauses in the narration where the soundtrack places it", async () => {
    // Half a second of tone, a second of silence, half a second of tone.
    const take = spawnSync(ffmpeg, [
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.5",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=mono:d=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.5",
      "-filter_complex",
      "[0][1][2]concat=n=3:v=0:a=1",
      "-f",
      "mp3",
      "pipe:1",
    ]).stdout;
    mocks.readVoiceClip.mockResolvedValue(take);
    const silences = await voiceSilences({
      ...artifact(3),
      voices: [{ start: 0.4 }],
    } as VideoArtifact);
    // Before the take starts and between its two tones.
    expect(silences).toHaveLength(2);
    expect(silences[0]![0]).toBe(0);
    expect(silences[0]![1]).toBeCloseTo(0.4, 1);
    expect(silences[1]![0]).toBeCloseTo(0.9, 1);
    expect(silences[1]![1]).toBeCloseTo(1.9, 1);
  });

  it("renders as many frames as the cut lasts", () => {
    const film = artifact(12);
    expect(segmentRanges(film).at(-1)!.to).toBe(360);
    expect(segmentRanges(film, edit)).toEqual([{ from: 0, to: 99 }]);
  });

  it("encodes at a quality target with a bitrate ceiling, the landscape MP4 as before", () => {
    expect(videoCodecArgs("landscape")).toEqual([
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
    ]);
    const vertical = videoCodecArgs("vertical").join(" ");
    expect(vertical).toContain("-crf 14");
    expect(vertical).toContain("-maxrate 8M -bufsize 16M");
    expect(vertical).toContain("-pix_fmt yuv420p");
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
