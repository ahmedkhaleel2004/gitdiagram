const DEFAULT_MAX_WAIT_MS = 24;
const DEFAULT_MAX_CHARACTERS = 2_048;

interface CoalesceTextChunksOptions {
  maxWaitMs?: number;
  maxCharacters?: number;
}

export function canWriteStreamMessage(params: {
  abortCause: "client" | "deadline" | null;
  aborted: boolean;
  allowDeadlineTerminal: boolean;
  streamClosed: boolean;
}): boolean {
  if (params.streamClosed) {
    return false;
  }
  if (!params.aborted) {
    return true;
  }

  return params.allowDeadlineTerminal && params.abortCause === "deadline";
}

type NextChunkResult =
  { type: "chunk"; result: IteratorResult<string, void> } | { type: "timeout" };

/**
 * Coalesces high-frequency model deltas without changing their bytes or order.
 *
 * The first visible delta is yielded immediately. Later deltas are grouped for
 * at most one animation frame, or until the size bound is reached. Because the
 * generator does not request another source chunk while its consumer is
 * processing a yielded batch, downstream SSE backpressure propagates all the
 * way to the model stream.
 */
export async function* coalesceTextChunks(
  source: AsyncIterable<string>,
  options: CoalesceTextChunksOptions = {},
): AsyncGenerator<string, void, void> {
  const maxWaitMs = Math.max(options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS, 0);
  const maxCharacters = Math.max(
    options.maxCharacters ?? DEFAULT_MAX_CHARACTERS,
    1,
  );
  const iterator = source[Symbol.asyncIterator]();
  let pendingNext: Promise<IteratorResult<string, void>> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const nextChunk = () => {
    pendingNext ??= iterator.next();
    return pendingNext;
  };

  try {
    const first = await nextChunk();
    pendingNext = null;
    if (first.done) {
      return;
    }
    if (first.value) {
      yield first.value;
    }

    let buffer = "";
    let batchStartedAt = 0;

    while (true) {
      const nextPromise = nextChunk().then((result): NextChunkResult => ({
        type: "chunk",
        result,
      }));
      let next: NextChunkResult;

      if (!buffer || maxWaitMs === 0) {
        next = await nextPromise;
      } else {
        const remainingMs = Math.max(
          0,
          maxWaitMs - (performance.now() - batchStartedAt),
        );
        next = await Promise.race([
          nextPromise,
          new Promise<NextChunkResult>((resolve) => {
            timeout = setTimeout(
              () => resolve({ type: "timeout" }),
              remainingMs,
            );
          }),
        ]);
      }

      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }

      if (next.type === "timeout") {
        if (buffer) {
          const batch = buffer;
          buffer = "";
          yield batch;
        }
        continue;
      }

      pendingNext = null;
      if (next.result.done) {
        if (buffer) {
          yield buffer;
        }
        return;
      }

      const chunk = next.result.value;
      if (!chunk) {
        continue;
      }
      if (!buffer) {
        batchStartedAt = performance.now();
      }
      buffer += chunk;

      if (buffer.length >= maxCharacters || maxWaitMs === 0) {
        const batch = buffer;
        buffer = "";
        yield batch;
      }
    }
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (iterator.return) {
      await iterator.return();
    }
  }
}
