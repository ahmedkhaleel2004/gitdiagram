import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  readRepositoryForVideo: vi.fn(),
  direct: vi.fn(),
  design: vi.fn(),
  narrateBeats: vi.fn(),
  writeVideo: vi.fn(),
  pictureIds: ["img1", "img2"],
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
    get pictureIds() {
      return mocks.pictureIds;
    },
  }),
}));
vi.mock("./narration", () => ({ narrateBeats: mocks.narrateBeats }));
vi.mock("./store", () => ({ writeVideo: mocks.writeVideo }));

import type {
  VideoArtifact,
  VideoGenerationEvent,
} from "~/features/explainer/types";
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

const picture = (id: string) => ({
  id,
  mediaType: "image/png",
  data: "",
  width: 800,
  height: 400,
  alt: "",
  bytes: Buffer.from(id),
});

/** A shot putting the given pictures on screen. */
const showing = (...ids: string[]) => ({
  elements: ids.map((id) => ({
    id,
    kind: "image",
    src: id,
    x: 1,
    y: 1,
    w: 4,
    h: 2,
  })),
  actions: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  mocks.pictureIds = ["img1", "img2"];
  mocks.readRepositoryForVideo.mockResolvedValue({
    meta: {},
    prompt: {},
    facts: { name: "b", paths: [], sourceText: "", images: [] },
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

  it("stores only the pictures the film shows, with their stable addresses", async () => {
    mocks.readRepositoryForVideo.mockResolvedValue({
      meta: {},
      prompt: {},
      facts: {
        name: "b",
        paths: [],
        sourceText: "",
        images: ["img1", "img2", "img3"],
      },
      sourceFileCount: 3,
      pictures: [picture("img1"), picture("img2"), picture("img3")],
    });
    // img2 was refused by a model API during the run, so it was never seen.
    mocks.pictureIds = ["img1", "img3"];
    mocks.design.mockResolvedValue(new Map([[0, showing("img1", "img2")]]));
    await generateExplainerVideo({
      username: "a",
      repo: "b",
      onEvent: () => undefined,
    });
    const [artifact, , stored] = mocks.writeVideo.mock.calls[0]! as [
      VideoArtifact,
      Buffer[],
      Array<{ id: string }>,
    ];
    expect(stored.map((p) => p.id)).toEqual(["img1"]);
    expect(Object.keys(artifact.plan.images ?? {})).toEqual(["img1"]);
    expect(artifact.plan.images!.img1).toBe(
      `/api/video/file?username=a&repo=b&format=picture&id=img1&v=${encodeURIComponent(artifact.createdAt)}`,
    );
    expect(artifact.plan.beats[0]!.elements.map((e) => e.src)).toEqual([
      "img1",
    ]);
  });

  it("stores no pictures when the film shows none", async () => {
    mocks.design.mockResolvedValue(new Map());
    await generateExplainerVideo({
      username: "a",
      repo: "b",
      onEvent: () => undefined,
    });
    const [artifact, , stored] = mocks.writeVideo.mock.calls[0]! as [
      VideoArtifact,
      Buffer[],
      unknown[],
    ];
    expect(stored).toEqual([]);
    expect(artifact.plan.images).toBeUndefined();
    expect(artifact.plan.beats).toHaveLength(3);
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

  it("stores nothing when the scenes could not be designed", async () => {
    mocks.design.mockRejectedValue(
      new Error(
        "The scenes could not be designed (3 of 3 beats have no shot).",
      ),
    );
    await expect(
      generateExplainerVideo({
        username: "a",
        repo: "b",
        onEvent: () => undefined,
      }),
    ).rejects.toThrow("could not be designed");
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
