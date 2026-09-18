/** Retry a slow managed request once, after cancelling its connection.
 * The replacement uses the same model and evidence. Normal requests pay for
 * one completion; user cancellation and ordinary errors never start another.
 */
export async function withSlowRequestRetry<T>(params: {
  signal: AbortSignal;
  retryAfterMs?: number;
  run: (signal: AbortSignal, attempt: number) => Promise<T>;
  onRetry: () => Promise<void>;
}): Promise<T> {
  params.signal.throwIfAborted();
  if (params.retryAfterMs === undefined) return params.run(params.signal, 1);

  const controller = new AbortController();
  const signal = AbortSignal.any([params.signal, controller.signal]);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(
      new DOMException("Model request was slow.", "TimeoutError"),
    );
  }, params.retryAfterMs);
  try {
    return await params.run(signal, 1);
  } catch (error) {
    params.signal.throwIfAborted();
    if (!timedOut) throw error;
  } finally {
    clearTimeout(timer);
  }

  await params.onRetry();
  params.signal.throwIfAborted();
  return params.run(params.signal, 2);
}
