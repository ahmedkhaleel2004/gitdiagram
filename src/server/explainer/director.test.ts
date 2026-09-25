import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { stream, create } = vi.hoisted(() => ({
  stream: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => {
  // The SDK's own signature: status, body, message, headers, type.
  class APIError extends Error {
    constructor(
      readonly status: number | undefined,
      _body: unknown,
      message: string,
      _headers: unknown,
      readonly type: string | null = null,
    ) {
      super(message);
    }
  }
  return {
    default: class {
      static APIError = APIError;
      messages = { stream };
    },
  };
});

vi.mock("openai", () => ({
  default: class {
    responses = { create };
  },
}));

import Anthropic from "@anthropic-ai/sdk";
import {
  createFilmWriters,
  designGroups,
  pickScript,
  SCRIPT_HARD_WORD_LIMIT,
  VideoRefusalError,
  type Planner,
} from "./director";
import type { RepositoryContextInput } from "./repository";
import type { Script } from "./script";

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

const OPUS: Planner = { model: "claude-opus-5-5", effort: "low" };
const SOL: Planner = { model: "gpt-6-sol", effort: "medium" };
const STANDARD: Planner = { ...OPUS, designer: SOL };
const PREMIUM: Planner = { ...OPUS, fallback: SOL };
const PICTURE = {
  id: "img1",
  mediaType: "image/webp" as const,
  data: "AAAA",
  width: 800,
  height: 400,
};

/** A script of `beats` beats (four by default) with the given words per beat. */
function scriptOf(
  wordsPerBeat: number,
  scene = (i: number) => `s${i}`,
  beats = 4,
) {
  const line = Array.from({ length: wordsPerBeat }, () => "word").join(" ");
  return {
    title: "Demo",
    outro: "The end",
    beats: Array.from({ length: beats }, (_, i) => ({
      scene: scene(i),
      narration: line,
      brief: "b",
    })),
  } satisfies Script;
}

/** A reply that calls write_script with a script of `words` words in four beats. */
function scriptReply(words: number, stop = "tool_use", beats = 4) {
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
          input: scriptOf(Math.ceil(words / beats), undefined, beats),
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

const failing = (error: Error) => ({
  finalMessage: async () => {
    throw error;
  },
});

/** An OpenAI response calling write_script with a script of `words` words. */
function openAIScriptReply(words: number, status = "completed") {
  return {
    status,
    incomplete_details:
      status === "completed" ? null : { reason: "max_output_tokens" },
    usage: {
      input_tokens: 2_000_000,
      input_tokens_details: { cached_tokens: 1_000_000, cache_write_tokens: 0 },
      output_tokens: 100_000,
    },
    output: [
      {
        type: "function_call",
        name: "write_script",
        arguments: JSON.stringify(scriptOf(Math.ceil(words / 4))),
      },
    ],
  };
}

/** An OpenAI response designing every beat it was asked for. */
function openAIShotsReply(request: { input: Array<{ content: unknown }> }) {
  const task = JSON.stringify(request.input.at(-1)!.content);
  const beats = /beats ([\d, ]+) and submit/.exec(task)![1]!.split(", ");
  return {
    status: "completed",
    usage: { input_tokens: 0, output_tokens: 0 },
    output: [
      {
        type: "function_call",
        name: "write_shots",
        arguments: JSON.stringify({
          shots: beats.map((beat) => ({
            beat: Number(beat),
            elements: [],
            actions: [],
          })),
        }),
      },
    ],
  };
}

/** A Claude reply designing every beat it was asked for. */
function claudeShotsReply(request: {
  messages: Array<{ content: Array<{ text?: string }> }>;
}) {
  const task = request.messages[0]!.content.at(-1)!.text!;
  const beats = /beats ([\d, ]+) and submit/.exec(task)![1]!.split(", ");
  return reply({
    stop_reason: "tool_use",
    content: [
      {
        type: "tool_use",
        name: "write_shots",
        input: {
          shots: beats.map((beat) => ({ beat: Number(beat), elements: [] })),
        },
      },
    ],
  });
}

const isPrewarm = (request: { prompt_cache_options?: { prewarm?: boolean } }) =>
  Boolean(request.prompt_cache_options?.prewarm);

const PREWARM_REPLY = {
  status: "completed",
  usage: {
    input_tokens: 1_000_000,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 1_000_000 },
    output_tokens: 0,
  },
  output: [],
};

type OpenAIRequest = {
  model: string;
  store: boolean;
  instructions?: string;
  prompt_cache_options: { mode: string; prewarm?: boolean };
  input: Array<{
    role: string;
    content: Array<{
      type: string;
      text?: string;
      prompt_cache_breakpoint?: unknown;
    }>;
  }>;
};
const openAIRequests = () =>
  create.mock.calls.map(([request]) => request as OpenAIRequest);

beforeEach(() => {
  stream.mockReset();
  create.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("the director", () => {
  it("prices cache reads at the model's own rate", async () => {
    stream.mockReturnValueOnce(scriptReply(120));
    const writers = createFilmWriters(input, OPUS);
    await writers.direct();
    // A million uncached input tokens ($4) and a million cache reads ($0.20).
    expect(writers.usage.costUsd).toBeCloseTo(4.2);
  });

  it("writes with GPT-6 Sol through the Responses API", async () => {
    create.mockResolvedValueOnce(openAIScriptReply(120));
    const writers = createFilmWriters(input, SOL);
    const script = await writers.direct();
    expect(script.beats).toHaveLength(4);
    expect(stream).not.toHaveBeenCalled();
    const request = create.mock.calls[0]![0] as {
      model: string;
      reasoning: { effort: string };
      tool_choice: { name: string };
    };
    expect(request.model).toBe("gpt-6-sol");
    expect(request.reasoning.effort).toBe("medium");
    expect(request.tool_choice.name).toBe("write_script");
    // A million uncached ($2), a million cached ($0.20), 100k out ($1).
    expect(writers.usage.costUsd).toBeCloseTo(3.2);
  });

  it("prices OpenAI cache writes at 1.25× input", async () => {
    create.mockResolvedValueOnce({
      ...openAIScriptReply(120),
      usage: {
        input_tokens: 3_000_000,
        input_tokens_details: {
          cached_tokens: 1_000_000,
          cache_write_tokens: 1_000_000,
        },
        output_tokens: 0,
      },
    });
    const writers = createFilmWriters(input, SOL);
    await writers.direct();
    // A million ordinary ($2), a million read ($0.20), a million written ($2.50).
    expect(writers.usage.costUsd).toBeCloseTo(4.7);
  });

  it("caches only the shared prefix on OpenAI, never a designer's own task", async () => {
    create.mockImplementation(async (request: OpenAIRequest) =>
      request.input.at(-1)!.content[0]!.text!.includes("DIRECTOR")
        ? openAIScriptReply(120)
        : openAIShotsReply(request),
    );
    const writers = createFilmWriters(input, SOL, { images: [PICTURE] });
    await writers.design(await writers.direct());
    for (const request of openAIRequests()) {
      expect(request.store).toBe(false);
      expect(request.instructions).toBeUndefined();
      expect(request.prompt_cache_options).toEqual({ mode: "explicit" });
      const [developer, shared, task] = request.input;
      expect(developer!.role).toBe("developer");
      expect(developer!.content[0]!.text).toContain("GitHub repository");
      expect(shared!.content[0]!.type).toBe("input_image");
      expect(shared!.content.at(-1)!.prompt_cache_breakpoint).toEqual({
        mode: "explicit",
      });
      expect(task!.content[0]!.prompt_cache_breakpoint).toBeUndefined();
    }
    // Every call shares the same prefix up to the breakpoint.
    const prefixes = openAIRequests().map((request) =>
      JSON.stringify(request.input.slice(0, 2)),
    );
    expect(new Set(prefixes).size).toBe(1);
  });

  it("lets Opus write the script and GPT-6 Sol design the scenes, warming Sol's cache meanwhile", async () => {
    stream.mockReturnValueOnce(scriptReply(120));
    create.mockImplementation(async (request: OpenAIRequest) =>
      isPrewarm(request) ? PREWARM_REPLY : openAIShotsReply(request),
    );
    const writers = createFilmWriters(input, STANDARD);
    expect(writers.model).toBe("claude-opus-5-5+gpt-6-sol");
    const script = await writers.direct();
    // The prewarm was the only OpenAI call while Opus directed.
    expect(openAIRequests().map(isPrewarm)).toEqual([true]);
    const prewarm = openAIRequests()[0]!;
    expect(prewarm.prompt_cache_options).toEqual({
      mode: "explicit",
      prewarm: true,
    });
    expect(prewarm.input).toHaveLength(2);
    await writers.design(script);
    expect(stream).toHaveBeenCalledTimes(1);
    const designers = openAIRequests().slice(1);
    expect(designers).toHaveLength(designGroups(script).length);
    expect(designers[0]).toMatchObject({
      model: "gpt-6-sol",
      reasoning: { effort: "medium" },
      tool_choice: { name: "write_shots" },
    });
    // The designers' prefix is exactly what was warmed.
    expect(JSON.stringify(designers[0]!.input.slice(0, 2))).toBe(
      JSON.stringify(prewarm.input),
    );
    // Nobody reads an Opus cache here, so the director does not write one.
    const director = stream.mock.calls[0]![0] as {
      messages: Array<{ content: Array<{ cache_control?: unknown }> }>;
    };
    expect(
      director.messages[0]!.content.some((block) => block.cache_control),
    ).toBe(false);
    // The prewarm's million cache-written tokens cost 1.25 × $2.
    expect(writers.usage.costUsd).toBeCloseTo(4.2 + 2.5);
  });

  it("caches the Opus director's prefix when Opus also designs", async () => {
    stream.mockReturnValueOnce(scriptReply(120));
    await createFilmWriters(input, PREMIUM).direct();
    const director = stream.mock.calls[0]![0] as {
      messages: Array<{ content: Array<{ cache_control?: unknown }> }>;
    };
    expect(director.messages[0]!.content[0]!.cache_control).toEqual({
      type: "ephemeral",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("has the designers' model write the script when the director fails", async () => {
    stream.mockReturnValue(
      failing(new Error("Your credit balance is too low")),
    );
    create.mockImplementation(async (request: OpenAIRequest) =>
      isPrewarm(request) ? PREWARM_REPLY : openAIScriptReply(120),
    );
    const writers = createFilmWriters(input, STANDARD);
    const script = await writers.direct();
    expect(script.beats).toHaveLength(4);
    expect(openAIRequests().filter((r) => !isPrewarm(r))[0]).toMatchObject({
      model: "gpt-6-sol",
    });
    expect(writers.model).toBe("gpt-6-sol");
  });

  it("hands a premium film to Sol, script and scenes, when Opus fails", async () => {
    stream.mockReturnValue(
      failing(new Error("Your credit balance is too low")),
    );
    create.mockImplementation(async (request: OpenAIRequest) =>
      request.input.at(-1)!.content[0]!.text!.includes("DIRECTOR")
        ? openAIScriptReply(120)
        : openAIShotsReply(request),
    );
    const writers = createFilmWriters(input, PREMIUM);
    expect(writers.model).toBe("claude-opus-5-5");
    const script = await writers.direct();
    expect(writers.model).toBe("gpt-6-sol");
    const designed = await writers.design(script);
    expect(designed.size).toBe(script.beats.length);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(
      openAIRequests().every((request) => request.model === "gpt-6-sol"),
    ).toBe(true);
  });

  it("does not hand a refused repository to the designers' model", async () => {
    stream.mockReturnValue(reply({ stop_reason: "refusal" }));
    create.mockResolvedValue(PREWARM_REPLY);
    await expect(
      createFilmWriters(input, STANDARD).direct(),
    ).rejects.toBeInstanceOf(VideoRefusalError);
    expect(openAIRequests().filter((r) => !isPrewarm(r))).toEqual([]);
  });

  it("shows README pictures to the model before the repository text", async () => {
    stream.mockReturnValueOnce(scriptReply(120));
    await createFilmWriters(input, OPUS, { images: [PICTURE] }).direct();
    const request = stream.mock.calls[0]![0] as {
      messages: Array<{ content: Array<{ type: string; text?: string }> }>;
    };
    const content = request.messages[0]!.content;
    expect(content[0]!.type).toBe("image");
    expect(content[1]!.text).toContain("- img1: 800×400");
  });

  it("drops the pictures and asks once more when an API refuses one", async () => {
    stream
      .mockReturnValueOnce(
        failing(
          Object.assign(new Error("Could not process image"), { status: 400 }),
        ),
      )
      .mockReturnValueOnce(scriptReply(120));
    const writers = createFilmWriters(input, OPUS, { images: [PICTURE] });
    expect(writers.pictureIds).toEqual(["img1"]);
    await writers.direct();
    const second = stream.mock.calls[1]![0] as {
      messages: Array<{ content: Array<{ type: string; text?: string }> }>;
    };
    expect(second.messages[0]!.content[0]!.type).toBe("text");
    expect(second.messages[0]!.content[0]!.text).not.toContain("img1");
    expect(writers.pictureIds).toEqual([]);
  });

  it("retries an OpenAI reply that stopped early", async () => {
    create
      .mockResolvedValueOnce(openAIScriptReply(120, "incomplete"))
      .mockResolvedValueOnce(openAIScriptReply(120));
    await createFilmWriters(input, SOL).direct();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("retries a reply cut off at max_tokens instead of using it", async () => {
    stream
      .mockReturnValueOnce(scriptReply(120, "max_tokens"))
      .mockReturnValueOnce(scriptReply(120));
    const script = await createFilmWriters(input, OPUS).direct();
    expect(stream).toHaveBeenCalledTimes(2);
    expect(script.beats).toHaveLength(4);
  });

  it("retries once when Claude is overloaded after its reply started", async () => {
    stream
      .mockReturnValueOnce(
        failing(
          new Anthropic.APIError(
            undefined,
            undefined,
            "Overloaded",
            undefined,
            "overloaded_error",
          ),
        ),
      )
      .mockReturnValueOnce(scriptReply(120));
    const script = await createFilmWriters(input, OPUS).direct();
    expect(stream).toHaveBeenCalledTimes(2);
    expect(script.beats).toHaveLength(4);
  });

  it("never asks again after a refusal", async () => {
    stream.mockReturnValue(reply({ stop_reason: "refusal" }));
    await expect(
      createFilmWriters(input, OPUS).direct(),
    ).rejects.toBeInstanceOf(VideoRefusalError);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("leaves API errors to the SDK's own retries", async () => {
    stream.mockReturnValue(failing(new Error("400 invalid request")));
    await expect(createFilmWriters(input, OPUS).direct()).rejects.toThrow(
      "400",
    );
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("does not accept a shortened script that is still far too long, nor rewrite it on another model", async () => {
    stream
      .mockReturnValueOnce(scriptReply(240))
      .mockReturnValueOnce(scriptReply(200));
    await expect(createFilmWriters(input, PREMIUM).direct()).rejects.toThrow(
      /too long/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps a slightly long first draft when shortening fails", async () => {
    stream
      .mockReturnValueOnce(scriptReply(148))
      .mockReturnValue(failing(new Error("overloaded")));
    const script = await createFilmWriters(input, OPUS).direct();
    expect(script.beats[0]!.narration.split(" ")).toHaveLength(37);
  });

  it("sends a script with too many beats back to be shortened", async () => {
    stream
      .mockReturnValueOnce(scriptReply(120, "tool_use", 24))
      .mockReturnValueOnce(scriptReply(120, "tool_use", 16));
    const script = await createFilmWriters(input, OPUS).direct();
    expect(stream).toHaveBeenCalledTimes(2);
    const trim = stream.mock.calls[1]![0] as {
      messages: Array<{ content: Array<{ text?: string }> }>;
    };
    expect(trim.messages[0]!.content.at(-1)!.text).toContain("22 beats");
    expect(script.beats).toHaveLength(16);
  });

  it("makes at most three director calls in a run", async () => {
    stream.mockReturnValue(scriptReply(120, "max_tokens"));
    create.mockResolvedValue(openAIScriptReply(240, "incomplete"));
    await expect(createFilmWriters(input, PREMIUM).direct()).rejects.toThrow(
      /stopped early/,
    );
    // Two Opus drafts, then one Sol draft with no retry left.
    expect(stream).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("the designers", () => {
  const script = scriptOf(3, (i) => `s${i}`, 6);

  it("retries a failed scene once on the director's model", async () => {
    create.mockImplementation(async (request: OpenAIRequest) => {
      if (JSON.stringify(request.input).includes("scene s2"))
        throw new Error("500 server error");
      return openAIShotsReply(request);
    });
    stream.mockImplementation(claudeShotsReply);
    const writers = createFilmWriters(input, STANDARD);
    const designed = await writers.design(script);
    expect(designed.size).toBe(6);
    expect(stream).toHaveBeenCalledTimes(1);
    const retry = stream.mock.calls[0]![0] as {
      model: string;
      messages: Array<{ content: Array<{ cache_control?: unknown }> }>;
    };
    expect(retry.model).toBe("claude-opus-5-5");
    // A lone call writes no cache.
    expect(retry.messages[0]!.content.some((b) => b.cache_control)).toBe(false);
  });

  it("draws a single failed scene as plain type", async () => {
    create.mockImplementation(async (request: OpenAIRequest) => {
      if (JSON.stringify(request.input).includes("scene s2"))
        throw new Error("500 server error");
      return openAIShotsReply(request);
    });
    const designed = await createFilmWriters(input, SOL).design(script);
    expect([...designed.keys()].sort()).toEqual([0, 1, 3, 4, 5]);
  });

  it("fails the film when most scenes cannot be designed", async () => {
    create.mockRejectedValue(new Error("429 insufficient_quota"));
    stream.mockReturnValue(failing(new Error("credit balance is too low")));
    const onDesigned = vi.fn();
    await expect(
      createFilmWriters(input, STANDARD).design(script, undefined, onDesigned),
    ).rejects.toThrow(/could not be designed/);
    expect(onDesigned).toHaveBeenCalledTimes(6);
  });

  it("stops at the deadline without retrying on another model", async () => {
    const deadline = new AbortController();
    create.mockImplementation(
      (_request: unknown, options: { signal: AbortSignal }) =>
        new Promise((_, reject) =>
          options.signal.addEventListener("abort", () =>
            reject(options.signal.reason as Error),
          ),
        ),
    );
    const run = createFilmWriters(input, STANDARD).design(
      script,
      deadline.signal,
    );
    deadline.abort(new Error("deadline"));
    await expect(run).rejects.toThrow("deadline");
    expect(stream).not.toHaveBeenCalled();
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

  it("joins beats rather than losing the ending when too many remain", () => {
    const many = scriptOf(4, (i) => `s${Math.floor(i / 3)}`, 26);
    many.beats.at(-1)!.narration = "the very end";
    const picked = pickScript([many, null])!;
    expect(picked.beats).toHaveLength(22);
    expect(picked.beats.at(-1)!.narration).toMatch(/the very end$/);
    const words = (s: Script) =>
      s.beats.map((beat) => beat.narration).join(" ");
    expect(words(picked)).toBe(words(many));
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
