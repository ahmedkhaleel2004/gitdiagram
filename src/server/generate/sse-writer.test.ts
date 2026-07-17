// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { DiagramStreamMessage } from "~/features/diagram/types";
import {
  createGenerationSseWriter,
  type GenerationStreamState,
} from "~/server/generate/sse-writer";

function createWriterHarness(highWaterMark = 1) {
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        streamController = controller;
      },
    },
    { highWaterMark },
  );
  const abortController = new AbortController();
  const state: GenerationStreamState = {
    streamClosed: false,
    wasCancelled: false,
  };
  let abortCause: "client" | "deadline" | null = null;
  const abortGeneration = vi.fn((cause: "client" | "deadline") => {
    abortCause ??= cause;
    if (!abortController.signal.aborted) {
      abortController.abort();
    }
  });
  const writer = createGenerationSseWriter({
    controller: streamController,
    signal: abortController.signal,
    state,
    getAbortCause: () => abortCause,
    abortGeneration,
  });

  return {
    abort(cause: "client" | "deadline") {
      abortCause ??= cause;
      abortController.abort();
      writer.notifyPull();
    },
    abortGeneration,
    state,
    stream,
    writer,
  };
}

function message(label: string): DiagramStreamMessage {
  return { status: "started", message: label };
}

function decodeChunk(
  result: ReadableStreamReadResult<Uint8Array>,
): string | undefined {
  return result.done ? undefined : new TextDecoder().decode(result.value);
}

describe("createGenerationSseWriter", () => {
  it("preserves queued write ordering", async () => {
    const harness = createWriterHarness(4);

    await expect(
      Promise.all([
        harness.writer.send(message("first")),
        harness.writer.send(message("second")),
        harness.writer.send(message("third")),
      ]),
    ).resolves.toEqual([true, true, true]);
    await harness.writer.close();

    const body = await new Response(harness.stream).text();
    expect(body).toBe(
      [
        'data: {"status":"started","message":"first"}',
        'data: {"status":"started","message":"second"}',
        'data: {"status":"started","message":"third"}',
        "",
      ].join("\n\n"),
    );
  });

  it("waits for capacity until notifyPull releases the queued write", async () => {
    const harness = createWriterHarness();
    const reader = harness.stream.getReader();

    await expect(harness.writer.send(message("first"))).resolves.toBe(true);
    let secondSettled = false;
    const secondWrite = harness.writer.send(message("second")).finally(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    expect(decodeChunk(await reader.read())).toContain('"message":"first"');
    harness.writer.notifyPull();
    await expect(secondWrite).resolves.toBe(true);
    expect(decodeChunk(await reader.read())).toContain('"message":"second"');

    await harness.writer.close();
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    reader.releaseLock();
  });

  it("drops a queued write when cancellation aborts while backpressured", async () => {
    const harness = createWriterHarness();

    await expect(harness.writer.send(message("first"))).resolves.toBe(true);
    const cancelledWrite = harness.writer.send(message("cancelled"));
    await Promise.resolve();

    harness.abort("client");

    await expect(cancelledWrite).resolves.toBe(false);
    await harness.writer.close();
    const body = await new Response(harness.stream).text();
    expect(body).toContain('"message":"first"');
    expect(body).not.toContain('"message":"cancelled"');
  });

  it("allows only an explicitly permitted terminal write after a deadline", async () => {
    const harness = createWriterHarness();

    await expect(harness.writer.send(message("first"))).resolves.toBe(true);
    harness.abort("deadline");

    await expect(harness.writer.send(message("dropped"))).resolves.toBe(false);
    await expect(
      harness.writer.send(
        { status: "error", error: "Generation timed out." },
        { allowDeadlineTerminal: true },
      ),
    ).resolves.toBe(true);
    await harness.writer.close();

    const body = await new Response(harness.stream).text();
    expect(body).toContain('"message":"first"');
    expect(body).not.toContain('"message":"dropped"');
    expect(body).toContain('"error":"Generation timed out."');
  });

  it("marks cancellation and aborts generation when enqueue fails", async () => {
    const state: GenerationStreamState = {
      streamClosed: false,
      wasCancelled: false,
    };
    const abortController = new AbortController();
    const abortGeneration = vi.fn();
    const controller = {
      desiredSize: 1,
      enqueue: vi.fn(() => {
        throw new Error("consumer closed");
      }),
      close: vi.fn(),
      error: vi.fn(),
    } as unknown as ReadableStreamDefaultController<Uint8Array>;
    const writer = createGenerationSseWriter({
      controller,
      signal: abortController.signal,
      state,
      getAbortCause: () => null,
      abortGeneration,
    });

    await expect(writer.send(message("unwritable"))).resolves.toBe(false);

    expect(state).toEqual({ streamClosed: true, wasCancelled: true });
    expect(abortGeneration).toHaveBeenCalledWith("client");
    await writer.close();
    expect(controller.close).not.toHaveBeenCalled();
  });

  it("waits for the queued write tail before closing", async () => {
    const harness = createWriterHarness();
    const reader = harness.stream.getReader();

    await expect(harness.writer.send(message("first"))).resolves.toBe(true);
    const secondWrite = harness.writer.send(message("second"));
    let closeSettled = false;
    const close = harness.writer.close().finally(() => {
      closeSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(closeSettled).toBe(false);

    expect(decodeChunk(await reader.read())).toContain('"message":"first"');
    harness.writer.notifyPull();
    await expect(secondWrite).resolves.toBe(true);
    await expect(close).resolves.toBeUndefined();
    expect(decodeChunk(await reader.read())).toContain('"message":"second"');
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    reader.releaseLock();
  });
});
