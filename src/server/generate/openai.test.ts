import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const openAiMocks = vi.hoisted(() => ({
  clientOptions: vi.fn(),
  responsesCreate: vi.fn(),
  responsesParse: vi.fn(),
  responsesRetrieve: vi.fn(),
  chatCompletionsCreate: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    constructor(options: unknown) {
      openAiMocks.clientOptions(options);
    }

    responses = {
      create: openAiMocks.responsesCreate,
      parse: openAiMocks.responsesParse,
      retrieve: openAiMocks.responsesRetrieve,
    };

    chat = {
      completions: {
        create: openAiMocks.chatCompletionsCreate,
      },
    };
  },
}));

import {
  generateStructuredOutput,
  streamCompletion,
} from "~/server/generate/openai";

async function* asAsyncEvents(events: unknown[]) {
  for (const event of events) {
    yield event;
  }
}

async function consume(stream: AsyncGenerator<string, void, void>) {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

function completedEvents(text = "done") {
  return asAsyncEvents([
    { type: "response.output_text.delta", delta: text },
    {
      type: "response.completed",
      response: {
        id: "resp_test",
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OpenAI Responses text verbosity", () => {
  it("bounds costly requests and attaches a production correlation id", async () => {
    openAiMocks.responsesCreate.mockResolvedValue(completedEvents());
    const signal = new AbortController().signal;

    const result = await streamCompletion({
      provider: "openai",
      model: "gpt-5.6-terra",
      systemPrompt: "system",
      userPrompt: "user",
      apiKey: "sk-test",
      signal,
      clientRequestId: "session:explanation",
    });

    await consume(result.stream);
    expect(openAiMocks.clientOptions).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 0, timeout: 150_000 }),
    );
    expect(openAiMocks.responsesCreate).toHaveBeenCalledWith(
      expect.any(Object),
      {
        signal,
        headers: { "X-Client-Request-Id": "session:explanation" },
      },
    );
  });

  it("sends text.verbosity for an exact dated GPT-5.6 streaming model", async () => {
    openAiMocks.responsesCreate.mockResolvedValue(completedEvents());

    const result = await streamCompletion({
      provider: "openai",
      model: "gpt-5.6-terra-2026-07-09",
      systemPrompt: "system",
      userPrompt: "user",
      apiKey: "sk-test",
      textVerbosity: "low",
    });

    await expect(consume(result.stream)).resolves.toEqual(["done"]);
    await expect(result.usagePromise).resolves.toMatchObject({
      totalTokens: 15,
    });
    expect(openAiMocks.responsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ text: { verbosity: "low" } }),
      undefined,
    );
  });

  it("omits text.verbosity for unsupported models and providers", async () => {
    openAiMocks.responsesCreate
      .mockResolvedValueOnce(completedEvents())
      .mockResolvedValueOnce(completedEvents());

    const oldModelResult = await streamCompletion({
      provider: "openai",
      model: "gpt-5.4",
      systemPrompt: "system",
      userPrompt: "user",
      apiKey: "sk-test",
      textVerbosity: "low",
    });
    await consume(oldModelResult.stream);

    const proxyResult = await streamCompletion({
      provider: "openrouter",
      model: "gpt-5.6-terra",
      systemPrompt: "system",
      userPrompt: "user",
      apiKey: "sk-test",
      textVerbosity: "low",
    });
    await consume(proxyResult.stream);

    for (const [body] of openAiMocks.responsesCreate.mock.calls) {
      expect(body).not.toHaveProperty("text");
    }
  });

  it("merges verbosity with the structured-output text format", async () => {
    const schema = z.object({ value: z.string() });
    openAiMocks.responsesParse.mockResolvedValue({
      output_parsed: { value: "ok" },
      output_text: '{"value":"ok"}',
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });

    await generateStructuredOutput({
      provider: "openai",
      model: "gpt-5.6-luna",
      systemPrompt: "system",
      userPrompt: "user",
      schema,
      schemaName: "payload",
      apiKey: "sk-test",
      textVerbosity: "low",
    });

    const [body] = openAiMocks.responsesParse.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(body.text).toEqual(
      expect.objectContaining({
        format: expect.objectContaining({ type: "json_schema" }),
        verbosity: "low",
      }),
    );
  });
});

describe("OpenAI Responses incomplete streams", () => {
  it("fails even when an incomplete response already emitted visible output", async () => {
    openAiMocks.responsesCreate.mockResolvedValue(
      asAsyncEvents([
        { type: "response.output_text.delta", delta: "partial" },
        {
          type: "response.incomplete",
          response: {
            id: "resp_incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          },
        },
      ]),
    );

    const result = await streamCompletion({
      provider: "openai",
      model: "gpt-5.6-terra",
      systemPrompt: "system",
      userPrompt: "user",
      apiKey: "sk-test",
      textVerbosity: "low",
    });

    await expect(consume(result.stream)).rejects.toThrow(
      "OpenAI response incomplete: max_output_tokens.",
    );
    await expect(result.usagePromise).resolves.toBeNull();
  });

  it("rejects a stream that ends without a terminal response event", async () => {
    openAiMocks.responsesCreate.mockResolvedValue(
      asAsyncEvents([{ type: "response.output_text.delta", delta: "partial" }]),
    );

    const result = await streamCompletion({
      provider: "openai",
      model: "gpt-5.6-terra",
      systemPrompt: "system",
      userPrompt: "user",
      apiKey: "sk-test",
    });

    await expect(consume(result.stream)).rejects.toThrow(
      "OpenAI stream ended before response.completed.",
    );
    await expect(result.usagePromise).resolves.toBeNull();
  });
});
