import type { DiagramStreamMessage } from "~/features/diagram/types";
import { canWriteStreamMessage } from "./stream-buffer";
import { sseMessage } from "./types";

export interface GenerationStreamState {
  streamClosed: boolean;
  wasCancelled: boolean;
}

export interface StreamWriteOptions {
  allowDeadlineTerminal?: boolean;
}

export function createGenerationSseWriter(params: {
  controller: ReadableStreamDefaultController<Uint8Array>;
  signal: AbortSignal;
  state: GenerationStreamState;
  getAbortCause: () => "client" | "deadline" | null;
  abortGeneration: (cause: "client" | "deadline") => void;
}) {
  const encoder = new TextEncoder();
  const pullWaiters = new Set<() => void>();
  let writeTail: Promise<void> = Promise.resolve();

  const notifyPull = () => {
    for (const resolve of pullWaiters) {
      resolve();
    }
    pullWaiters.clear();
  };

  const canWrite = (options?: StreamWriteOptions) =>
    canWriteStreamMessage({
      abortCause: params.getAbortCause(),
      aborted: params.signal.aborted,
      allowDeadlineTerminal: Boolean(options?.allowDeadlineTerminal),
      streamClosed: params.state.streamClosed,
    });

  const waitForCapacity = async () => {
    while (
      !params.state.streamClosed &&
      !params.signal.aborted &&
      params.controller.desiredSize !== null &&
      params.controller.desiredSize <= 0
    ) {
      await new Promise<void>((resolve) => pullWaiters.add(resolve));
    }
  };

  const queueWrite = (
    message: string,
    options?: StreamWriteOptions,
  ): Promise<boolean> => {
    const write = writeTail.then(async () => {
      if (!canWrite(options)) {
        return false;
      }

      await waitForCapacity();
      if (!canWrite(options)) {
        return false;
      }

      try {
        params.controller.enqueue(encoder.encode(message));
        return true;
      } catch {
        params.state.streamClosed = true;
        params.state.wasCancelled = true;
        notifyPull();
        params.abortGeneration("client");
        return false;
      }
    });
    writeTail = write.then(() => undefined);
    return write;
  };

  const send = (
    payload: DiagramStreamMessage,
    options?: StreamWriteOptions,
  ): Promise<boolean> => {
    if (!canWrite(options)) {
      return Promise.resolve(false);
    }
    return queueWrite(sseMessage(payload), options);
  };

  const sendComment = (comment: string): Promise<boolean> => {
    if (params.state.streamClosed || params.signal.aborted) {
      return Promise.resolve(false);
    }
    return queueWrite(`: ${comment}\n\n`);
  };

  const close = async () => {
    await writeTail;
    if (params.state.streamClosed) {
      return;
    }
    params.state.streamClosed = true;
    try {
      params.controller.close();
    } catch {
      // The consumer may already have cancelled the stream.
    }
  };

  return { close, notifyPull, send, sendComment };
}
