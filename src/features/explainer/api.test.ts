import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchExplainerVideo,
  streamExplainerRender,
  streamExplainerVideo,
  VideoRequestError,
  VideoStreamEndedError,
} from "~/features/explainer/api";

const encoder = new TextEncoder();

/** A streamed response that sends each chunk as its own network read. */
function sse(...chunks: string[]) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("explainer video streams", () => {
  it("relays CRLF-framed events and a final one sent without a blank line", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sse(
          'data: {"status":"reading","elapsedMs":1}\r\n\r\n',
          'data: {"status":"error","error":"Nope."}',
        ),
      ),
    );
    const events: unknown[] = [];
    await streamExplainerVideo("acme", "tiny", (event) => events.push(event));
    expect(events).toEqual([
      { status: "reading", elapsedMs: 1 },
      { status: "error", error: "Nope." },
    ]);
  });

  it("rejects a stream that closes before a complete or error event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sse('data: {"status":"planning","elapsedMs":1}\n\n')),
    );
    await expect(
      streamExplainerVideo("acme", "tiny", () => undefined),
    ).rejects.toBeInstanceOf(VideoStreamEndedError);
  });

  it("sends the version on screen with an MP4 request and reports a stale one", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: "This video was replaced.", stale: true },
        { status: 409 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const request = streamExplainerRender(
      "acme",
      "tiny",
      "vertical",
      "2026-09-24T00:00:00.000Z",
      () => undefined,
    );
    await expect(request).rejects.toMatchObject({
      status: 409,
      stale: true,
    });
    await expect(request).rejects.toBeInstanceOf(VideoRequestError);
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string)).toEqual({
      username: "acme",
      repo: "tiny",
      format: "vertical",
      v: "2026-09-24T00:00:00.000Z",
    });
  });
});

describe("an MP4 render this tab lost sight of", () => {
  const ask = (onEvent: (event: unknown) => void = () => undefined) =>
    streamExplainerRender(
      "acme",
      "tiny",
      "landscape",
      "2026-09-24T00:00:00.000Z",
      onEvent,
      undefined,
      { askAgainMs: 1 },
    );

  it("is asked for again until the stored file answers", async () => {
    const fetchMock = vi
      .fn()
      // A deploy cut the stream mid-render.
      .mockResolvedValueOnce(
        sse('data: {"status":"rendering","progress":0.4}\n\n'),
      )
      // The render carries on in the container and holds its lock.
      .mockResolvedValueOnce(
        Response.json(
          { error: "This MP4 is being made right now." },
          { status: 409 },
        ),
      )
      // The connection itself fails once.
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      // Briefly unavailable while instances are replaced.
      .mockResolvedValueOnce(
        Response.json({ error: "Unavailable." }, { status: 503 }),
      )
      .mockResolvedValueOnce(sse('data: {"status":"complete"}\n\n'));
    vi.stubGlobal("fetch", fetchMock);
    const events: unknown[] = [];
    await ask((event) => events.push(event));
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(events.at(-1)).toEqual({ status: "complete" });
  });

  it("gives up on a refusal that waiting cannot fix", async () => {
    for (const status of [429, 404, 403]) {
      const fetchMock = vi.fn(async () =>
        Response.json({ error: "No." }, { status }),
      );
      vi.stubGlobal("fetch", fetchMock);
      await expect(ask()).rejects.toMatchObject({ status });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    // A server that stays unavailable is not asked forever.
    const down = vi.fn(async () =>
      Response.json({ error: "Unavailable." }, { status: 503 }),
    );
    vi.stubGlobal("fetch", down);
    await expect(ask()).rejects.toMatchObject({ status: 503 });
    expect(down).toHaveBeenCalledTimes(4);
  });

  it("stops asking when the viewer leaves", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      controller.abort();
      return Response.json({ error: "Being made." }, { status: 409 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      streamExplainerRender(
        "acme",
        "tiny",
        "landscape",
        "2026-09-24T00:00:00.000Z",
        () => undefined,
        controller.signal,
        { askAgainMs: 1 },
      ),
    ).rejects.toBeInstanceOf(VideoRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchExplainerVideo", () => {
  it("passes on that a video is being made", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ ok: true, video: null, generating: true }),
      ),
    );
    expect(await fetchExplainerVideo("acme", "tiny")).toMatchObject({
      video: null,
      generating: true,
    });
  });
});
