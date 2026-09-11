// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  canWriteStreamMessage,
  coalesceTextChunks,
} from "~/server/generate/stream-buffer";

describe("canWriteStreamMessage", () => {
  it("keeps a terminal write eligible when a deadline fires after it was queued", () => {
    expect(
      canWriteStreamMessage({
        abortCause: null,
        aborted: false,
        allowDeadlineTerminal: true,
        streamClosed: false,
      }),
    ).toBe(true);

    expect(
      canWriteStreamMessage({
        abortCause: "deadline",
        aborted: true,
        allowDeadlineTerminal: true,
        streamClosed: false,
      }),
    ).toBe(true);
  });

  it("drops normal writes and client-cancelled terminal writes after abort", () => {
    expect(
      canWriteStreamMessage({
        abortCause: "deadline",
        aborted: true,
        allowDeadlineTerminal: false,
        streamClosed: false,
      }),
    ).toBe(false);
    expect(
      canWriteStreamMessage({
        abortCause: "client",
        aborted: true,
        allowDeadlineTerminal: true,
        streamClosed: false,
      }),
    ).toBe(false);
  });
});

async function collect(source: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of source) {
    chunks.push(chunk);
  }
  return chunks;
}

describe("coalesceTextChunks", () => {
  it("preserves every character in order while reducing synchronous deltas", async () => {
    async function* source() {
      yield "first";
      yield " ";
      yield "second";
      yield " ";
      yield "third";
    }

    const chunks = await collect(coalesceTextChunks(source()));

    expect(chunks).toEqual(["first", " second third"]);
    expect(chunks.join("")).toBe("first second third");
  });

  it("flushes a batch at the configured size bound", async () => {
    async function* source() {
      yield "a";
      yield "bb";
      yield "cc";
      yield "dd";
    }

    await expect(
      collect(coalesceTextChunks(source(), { maxCharacters: 4 })),
    ).resolves.toEqual(["a", "bbcc", "dd"]);
  });

  it("does not prefetch source chunks while the consumer handles a batch", async () => {
    let requested = 0;
    let releaseSecond!: () => void;
    const secondReady = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    async function* source() {
      requested += 1;
      yield "first";
      requested += 1;
      await secondReady;
      yield "second";
    }

    const iterator = coalesceTextChunks(source())[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ value: "first" });
    expect(requested).toBe(1);

    const second = iterator.next();
    expect(requested).toBe(2);
    releaseSecond();
    await expect(second).resolves.toMatchObject({ value: "second" });
    await iterator.return?.();
  });
});
