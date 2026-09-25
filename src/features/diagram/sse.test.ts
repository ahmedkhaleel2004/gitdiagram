import { describe, expect, it } from "vitest";

import {
  parseSSEChunk,
  parseSSEStreamBuffer,
  readSSEStream,
} from "~/features/diagram/sse";

/** A stream that sends each chunk as its own read; `open` leaves it unclosed. */
function body(chunks: Uint8Array[], open = false) {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (!open) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, cancelled: () => cancelled };
}

describe("readSSEStream", () => {
  it("decodes characters split across reads and flushes a final unterminated event", async () => {
    const bytes = new TextEncoder().encode(
      'data: {"status":"a","message":"café"}\r\n\r\ndata: {"status":"b"}',
    );
    // Split inside the two-byte "é".
    const split = bytes.indexOf(0xc3) + 1;
    const { stream } = body([bytes.slice(0, split), bytes.slice(split)]);

    const seen: Array<{ status: string; message?: string }> = [];
    const outcome = await readSSEStream<{ status: string; message?: string }>(
      stream,
      (message) => void seen.push(message),
    );
    expect(outcome).toBe("ended");
    expect(seen).toEqual([{ status: "a", message: "café" }, { status: "b" }]);
  });

  it("stops and cancels the stream when the handler says so", async () => {
    const encoder = new TextEncoder();
    const { stream, cancelled } = body(
      [encoder.encode('data: {"status":"a"}\n\ndata: {"status":"b"}\n\n')],
      true,
    );
    const seen: string[] = [];
    const outcome = await readSSEStream<{ status: string }>(
      stream,
      (message) => {
        seen.push(message.status);
        return false;
      },
    );
    expect(outcome).toBe("stopped");
    expect(seen).toEqual(["a"]);
    expect(cancelled()).toBe(true);
  });

  it("cancels the stream and passes on a handler's error", async () => {
    const { stream, cancelled } = body(
      [new TextEncoder().encode('data: {"status":"a"}\n\n')],
      true,
    );
    await expect(
      readSSEStream(stream, () => {
        throw new Error("bad event");
      }),
    ).rejects.toThrow("bad event");
    expect(cancelled()).toBe(true);
  });
});

describe("parseSSEChunk", () => {
  it("parses valid SSE data lines", () => {
    const chunk =
      'data: {"status":"started","message":"Starting"}\n\n' +
      'data: {"status":"graph","message":"Planning"}\n\n';

    const messages = parseSSEChunk(chunk);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.status).toBe("started");
    expect(messages[1]?.status).toBe("graph");
  });

  it("ignores malformed lines", () => {
    const chunk =
      "event: custom\n" +
      "data: {not-json}\n" +
      'data: {"status":"complete"}\n';

    const messages = parseSSEChunk(chunk);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.status).toBe("complete");
  });

  it("handles events split across network boundaries", () => {
    const firstHalf = 'data: {"status":"graph_retry","message":"Attempt 1';
    const secondHalf = '/3"}\n\n';

    const firstPass = parseSSEStreamBuffer(firstHalf);
    expect(firstPass.messages).toHaveLength(0);

    const secondPass = parseSSEStreamBuffer(firstPass.remainder + secondHalf);
    expect(secondPass.messages).toHaveLength(1);
    expect(secondPass.messages[0]?.status).toBe("graph_retry");
    expect(secondPass.messages[0]?.message).toBe("Attempt 1/3");
  });
});
