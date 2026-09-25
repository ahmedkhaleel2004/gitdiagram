import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  readRepositoryForVideo: vi.fn(),
  direct: vi.fn(),
  design: vi.fn(),
  narrateBeats: vi.fn(),
  writeVideo: vi.fn(),
}));

vi.mock("./repository", () => ({
  readRepositoryForVideo: mocks.readRepositoryForVideo,
}));
vi.mock("./director", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createFilmWriters: () => ({
    model: "claude-opus-5-5",
    usage: { calls: 1, inputTokens: 1, outputTokens: 1, costUsd: 0.1 },
    direct: mocks.direct,
    design: mocks.design,
  }),
}));
vi.mock("./narration", () => ({ narrateBeats: mocks.narrateBeats }));
vi.mock("./shots", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  normalizeShots: () => ({ plan: { scenes: [] }, warnings: [] }),
}));
vi.mock("./store", () => ({ writeVideo: mocks.writeVideo }));

import type { VideoGenerationEvent } from "~/features/explainer/types";
import { generateExplainerVideo } from "./generate";

// Scene "a" appears twice, apart: three designers, not two.
const SCRIPT = {
  title: "Demo",
  outro: "End",
  beats: ["a", "b", "a"].map((scene) => ({
    scene,
    narration: "one two",
    brief: "",
  })),
};

const NARRATION = {
  clips: [Buffer.from("mp3")],
  timing: { DURATION: 5, SPEECH_END: 1, beats: [] },
  voices: [{ start: 0.4 }],
  characters: 20,
};

/** Rejects once the signal aborts, noting when it settled. */
function untilAborted(signal: AbortSignal, log: string[]) {
  return new Promise((_, reject) =>
    signal.addEventListener("abort", () =>
      setTimeout(() => {
        log.push("designers settled");
        reject(signal.reason as Error);
      }, 20),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  mocks.readRepositoryForVideo.mockResolvedValue({
    meta: {},
    prompt: {},
    facts: {},
    sourceFileCount: 3,
    pictures: [],
  });
  mocks.direct.mockResolvedValue(SCRIPT);
  mocks.design.mockResolvedValue(new Map());
  mocks.narrateBeats.mockResolvedValue(NARRATION);
  mocks.writeVideo.mockResolvedValue(undefined);
});

describe("generateExplainerVideo", () => {
  it("counts one designer per run of adjacent beats", async () => {
    const events: VideoGenerationEvent[] = [];
    const onPaidWork = vi.fn();
    await generateExplainerVideo({
      username: "a",
      repo: "b",
      onEvent: (event) => events.push(event),
      onPaidWork,
    });
    const designing = events.filter((event) => event.status === "designing");
    expect(designing.at(-1)).toMatchObject({
      progress: { scenes: 3, voiced: 3 },
    });
    expect(onPaidWork).toHaveBeenCalledTimes(1);
    expect(mocks.writeVideo).toHaveBeenCalledTimes(1);
  });

  it("marks nothing as paid when the repository cannot be read", async () => {
    mocks.readRepositoryForVideo.mockRejectedValue(new Error("private"));
    const onPaidWork = vi.fn();
    await expect(
      generateExplainerVideo({
        username: "a",
        repo: "b",
        onEvent: () => undefined,
        onPaidWork,
      }),
    ).rejects.toThrow("private");
    expect(onPaidWork).not.toHaveBeenCalled();
    expect(mocks.direct).not.toHaveBeenCalled();
  });

  it("stops the designers when narration fails, and waits for them", async () => {
    const log: string[] = [];
    mocks.design.mockImplementation((_script, signal: AbortSignal) =>
      untilAborted(signal, log),
    );
    mocks.narrateBeats.mockRejectedValue(new Error("voice down"));
    await expect(
      generateExplainerVideo({
        username: "a",
        repo: "b",
        onEvent: () => undefined,
      }),
    )
      .rejects.toThrow("voice down")
      .then(() => log.push("run rejected"));
    expect(log).toEqual(["designers settled", "run rejected"]);
    expect(mocks.writeVideo).not.toHaveBeenCalled();
  });

  it("gives up at the deadline", async () => {
    const deadline = new AbortController();
    const log: string[] = [];
    mocks.design.mockImplementation((_script, signal: AbortSignal) =>
      untilAborted(signal, log),
    );
    mocks.narrateBeats.mockImplementation(
      (_beats, signal: AbortSignal) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () =>
            reject(signal.reason as Error),
          ),
        ),
    );
    const run = generateExplainerVideo({
      username: "a",
      repo: "b",
      onEvent: () => undefined,
      signal: deadline.signal,
    });
    setTimeout(() => deadline.abort(new Error("deadline")), 5);
    await expect(run).rejects.toThrow("deadline");
    expect(log).toEqual(["designers settled"]);
  });
});
