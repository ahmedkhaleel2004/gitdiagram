import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getDiagramState,
  streamDiagramGeneration,
} from "~/features/diagram/api";

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

describe("getDiagramState", () => {
  it("reads diagram state through the bounded same-origin API", async () => {
    const state = {
      diagram: "flowchart TD\nA-->B",
      explanation: "Example",
      graph: null,
      latestSessionAudit: null,
      lastSuccessfulAt: "2026-07-13T12:00:00.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json(state, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getDiagramState("openai", "openai-node", "github-pat"),
    ).resolves.toEqual(state);
    expect(fetchMock).toHaveBeenCalledWith("/api/diagram-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "openai",
        repo: "openai-node",
        github_pat: "github-pat",
      }),
    });
  });
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
    const streamBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as { cancel_token: string; session_id: string };
    expect(streamBody.session_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    expect(streamBody.cancel_token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
  });

  it("sends a same-origin keepalive cancellation when the caller aborts", async () => {
    const abortController = new AbortController();
    const fetchMock = vi.fn(
      (url: string, init?: RequestInit): Promise<Response> => {
        if (url === "/api/generate/cancel") {
          return Promise.resolve(new Response(null, { status: 204 }));
        }

        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const generation = streamDiagramGeneration(
      {
        username: "openai",
        repo: "openai-node",
        signal: abortController.signal,
      },
      { onMessage: vi.fn() },
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    abortController.abort();
    await expect(generation).rejects.toThrow("Aborted");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const streamBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as { cancel_token: string; session_id: string };
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/generate/cancel");
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        keepalive: true,
        body: JSON.stringify({
          session_id: streamBody.session_id,
          cancel_token: streamBody.cancel_token,
        }),
      }),
    );
  });

  it("does not send cancellation when a terminal event closes the reader", async () => {
    const readerCancelled = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('data: {"status":"complete"}\n\n'),
          );
        },
        cancel: readerCancelled,
      }),
      { status: 200 },
    );
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    await streamDiagramGeneration(
      { username: "openai", repo: "openai-node" },
      { onMessage: () => false },
    );

    expect(readerCancelled).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends cancellation when a handler stops a non-terminal stream", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('data: {"status":"started"}\n\n'),
          );
        },
      }),
      { status: 200 },
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await streamDiagramGeneration(
      { username: "openai", repo: "openai-node" },
      { onMessage: () => false },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/generate/cancel");
  });

  it("rejects a stream that closes without a terminal event", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        streamResponse([
          new TextEncoder().encode('data: {"status":"started"}\n\n'),
        ]),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      streamDiagramGeneration(
        { username: "openai", repo: "openai-node" },
        { onMessage: vi.fn() },
      ),
    ).rejects.toThrow("Generation stream ended before completion");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/generate/cancel");
  });

  it("sends cancellation when the response stream fails during a read", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('data: {"status":"started"}\n\n'),
          );
          controller.error(new Error("connection lost"));
        },
      }),
      { status: 200 },
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      streamDiagramGeneration(
        { username: "openai", repo: "openai-node" },
        { onMessage: vi.fn() },
      ),
    ).rejects.toThrow("connection lost");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/generate/cancel");
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
