import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { stream } = vi.hoisted(() => ({ stream: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { stream };
  },
}));

import {
  createFilmWriters,
  designGroups,
  pickScript,
  SCRIPT_HARD_WORD_LIMIT,
  VideoRefusalError,
} from "./director";
import type { RepositoryContextInput } from "./repository";
import type { Script } from "./shots";

const input: RepositoryContextInput = {
  owner: "acme",
  repo: "demo",
  url: "https://github.com/acme/demo",
  description: "",
  stars: 0,
  language: "",
  topics: [],
  readme: "# Demo",
  fileTree: "src/main.ts",
  treeTruncated: false,
  sourceText: "",
};

/** A script of four beats with the given words per beat. */
function scriptOf(wordsPerBeat: number, scene = (i: number) => `s${i}`) {
  const line = Array.from({ length: wordsPerBeat }, () => "word").join(" ");
  return {
    title: "Demo",
    outro: "The end",
    beats: [0, 1, 2, 3].map((i) => ({
      scene: scene(i),
      narration: line,
      spoken: line,
      brief: "b",
    })),
  } satisfies Script;
}

/** A reply that calls write_script with a script of `words` words in four beats. */
function scriptReply(words: number, stop = "tool_use") {
  const script = scriptOf(Math.ceil(words / 4));
  return {
    finalMessage: async () => ({
      stop_reason: stop,
      usage: {
        input_tokens: 1_000_000,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 1_000_000,
      },
      content: [
        {
          type: "tool_use",
          name: "write_script",
          input: {
            ...script,
            beats: script.beats.map(({ scene, narration, brief }) => ({
              scene,
              narration,
              brief,
            })),
          },
        },
      ],
    }),
  };
}

const reply = (message: Record<string, unknown>) => ({
  finalMessage: async () => ({
    usage: { input_tokens: 0, output_tokens: 0 },
    content: [],
    ...message,
  }),
});

beforeEach(() => {
  stream.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("the director", () => {
  it("prices cache reads at the model's own rate", async () => {
    stream.mockReturnValueOnce(scriptReply(120));
    const writers = createFilmWriters(input);
    await writers.direct();
    // A million uncached input tokens ($4) and a million cache reads ($0.20).
    expect(writers.usage.costUsd).toBeCloseTo(4.2);
  });

  it("retries a reply cut off at max_tokens instead of using it", async () => {
    stream
      .mockReturnValueOnce(scriptReply(120, "max_tokens"))
      .mockReturnValueOnce(scriptReply(120));
    const script = await createFilmWriters(input).direct();
    expect(stream).toHaveBeenCalledTimes(2);
    expect(script.beats).toHaveLength(4);
  });

  it("never asks again after a refusal", async () => {
    stream.mockReturnValue(reply({ stop_reason: "refusal" }));
    await expect(createFilmWriters(input).direct()).rejects.toBeInstanceOf(
      VideoRefusalError,
    );
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("leaves API errors to the SDK's own retries", async () => {
    stream.mockReturnValue({
      finalMessage: async () => {
        throw new Error("400 invalid request");
      },
    });
    await expect(createFilmWriters(input).direct()).rejects.toThrow("400");
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("does not accept a shortened script that is still far too long", async () => {
    stream
      .mockReturnValueOnce(scriptReply(240))
      .mockReturnValueOnce(scriptReply(200));
    await expect(createFilmWriters(input).direct()).rejects.toThrow(/too long/);
  });

  it("keeps a slightly long first draft when shortening fails", async () => {
    stream.mockReturnValueOnce(scriptReply(148)).mockReturnValue({
      finalMessage: async () => {
        throw new Error("overloaded");
      },
    });
    const script = await createFilmWriters(input).direct();
    expect(script.beats[0]!.narration.split(" ")).toHaveLength(37);
  });
});

describe("pickScript", () => {
  it("prefers a draft within the limit, then the shorter within the hard limit", () => {
    const long = scriptOf(40); // 160 words
    const longer = scriptOf(41); // 164 words
    const fits = scriptOf(30); // 120 words
    expect(pickScript([long, fits])).toBe(fits);
    expect(pickScript([longer, long])).toBe(long);
    expect(pickScript([long, null])).toBe(long);
    const tooLong = Math.floor(SCRIPT_HARD_WORD_LIMIT / 4) + 1;
    expect(pickScript([scriptOf(tooLong), null])).toBeNull();
  });
});

describe("designGroups", () => {
  it("gives each run of adjacent beats in one scene its own designer", () => {
    const groups = designGroups(scriptOf(3, (i) => (i === 1 ? "b" : "a")));
    expect(groups).toEqual([
      { scene: "a", beats: [0] },
      { scene: "b", beats: [1] },
      { scene: "a", beats: [2, 3] },
    ]);
  });
});
