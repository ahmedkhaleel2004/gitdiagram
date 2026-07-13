import { afterEach, describe, expect, it, vi } from "vitest";

import { streamDiagramGeneration } from "~/features/diagram/api";

function streamResponse(chunks: Uint8Array[], status = 200) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    {
      status,
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamDiagramGeneration", () => {
  it("preserves multibyte SSE data split across network chunks", async () => {
    const encoded = new TextEncoder().encode(
      'data: {"status":"complete","explanation":"diagram ✅"}\n\n',
    );
    const splitAt = encoded.indexOf(0xe2) + 1;
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamResponse([encoded.slice(0, splitAt), encoded.slice(splitAt)]),
      );
    vi.stubGlobal("fetch", fetchMock);
    const messages: unknown[] = [];
    const abortController = new AbortController();

    await streamDiagramGeneration(
      {
        username: "openai",
        repo: "openai-node",
        signal: abortController.signal,
      },
      {
        onMessage(message) {
          messages.push(message);
        },
      },
    );

    expect(messages).toEqual([
      expect.objectContaining({
        status: "complete",
        explanation: "diagram ✅",
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/generate/stream",
      expect.objectContaining({ signal: abortController.signal }),
    );
  });

  it("rejects a stream that closes without a terminal event", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          streamResponse([
            new TextEncoder().encode('data: {"status":"started"}\n\n'),
          ]),
        ),
    );

    await expect(
      streamDiagramGeneration(
        { username: "openai", repo: "openai-node" },
        { onMessage: vi.fn() },
      ),
    ).rejects.toThrow("Generation stream ended before completion");
  });

  it("normalizes a Vercel WAF rate-limit response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })),
    );

    await expect(
      streamDiagramGeneration(
        { username: "openai", repo: "openai-node" },
        { onMessage: vi.fn() },
      ),
    ).rejects.toThrow("Too many generation requests");
  });
});
