import { cloudflareContext } from "~/server/cloudflare-context";

// On Cloudflare Workers a fetch belongs to the request that started it. When
// that request is cancelled (the visitor closes the tab), its pending fetches
// are dropped and their promises never settle. A promise kept at module level
// for other requests to await then hangs every one of them, for as long as
// the isolate lives. Measured on a test Worker: after one cancelled starter,
// 6 of 8 later requests hung; with `waitUntil`, 0 of 8.

/**
 * Lets a promise that other requests may await finish even if the request
 * that started it is cancelled (Workers: `waitUntil`, up to 30 s after the
 * response). Does nothing on Node. Returns the same promise.
 */
export function outliveRequest<T>(promise: Promise<T>): Promise<T> {
  try {
    cloudflareContext()?.ctx?.waitUntil(
      promise.then(
        () => undefined,
        () => undefined,
      ),
    );
  } catch {
    // Outside a request (a cron's tail, a test): nothing to extend.
  }
  return promise;
}

// A read no caller waits on this long is taken for dead (its request was
// killed despite `waitUntil`) and started again, so one lost read can never
// hang an instance for good.
const ABANDONED_AFTER_MS = 30_000;

export interface SharedRead<T> {
  /** The read in flight, or a new one. */
  (): Promise<T>;
  /** Callers from now on start a new read; the one in flight is left alone. */
  forget(): void;
}

/**
 * One read in flight per instance, shared by every concurrent caller. Only
 * the in-flight promise is shared: callers cache the finished value.
 */
export function sharedRead<T>(read: () => Promise<T>): SharedRead<T> {
  let inFlight: { promise: Promise<T>; startedAt: number } | null = null;
  const run = () => {
    const now = Date.now();
    if (inFlight && now - inFlight.startedAt < ABANDONED_AFTER_MS)
      return inFlight.promise;
    const entry = {
      startedAt: now,
      promise: read().finally(() => {
        if (inFlight === entry) inFlight = null;
      }),
    };
    inFlight = entry;
    return outliveRequest(entry.promise);
  };
  run.forget = () => {
    inFlight = null;
  };
  return run;
}
