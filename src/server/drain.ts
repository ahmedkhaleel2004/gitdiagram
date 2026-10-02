import "server-only";

// A container is told to stop with SIGTERM: on a deploy, when its host is
// drained, or when the platform thinks it idle (a viewer who leaves closes
// the request, but the render or video they started carries on). Next's own
// handler stops listening at once, which fails a render mid-way: its
// remaining segments, the stage and the effect sounds are all requests to
// this server. So in a container the server handles the signal itself
// (NEXT_MANUAL_SIG_HANDLE, set in the Dockerfile; see instrumentation.ts):
// it keeps serving until the work below has finished, then exits. Vercel
// freezes and resumes functions instead, and none of this runs there.

/** Longest wait for work to finish; Cloudflare kills a container 15 minutes after SIGTERM. */
const DRAIN_LIMIT_MS = 14 * 60_000;

// One counter for the whole process: routes and the instrumentation hook are
// bundled apart, so module state would not be shared between them.
const state = ((
  globalThis as { __gitdiagramWork?: { count: number } }
).__gitdiagramWork ??= { count: 0 });

/** Work that must finish before the server may exit. Call the result when it ends. */
export function beginWork(): () => void {
  state.count++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    state.count--;
  };
}

/** `promise`, counted as work until it settles. */
export function trackWork<T>(promise: Promise<T>): Promise<T> {
  const end = beginWork();
  promise.then(end, end);
  return promise;
}

export const workInFlight = () => state.count;

/**
 * On SIGTERM or SIGINT, exit once no work is in flight (checked a few times
 * a second), or after the drain limit. `exit` and `now` are for tests.
 */
export function drainOnSignals(
  options: {
    exit?: (code: number) => void;
    pollMs?: number;
    limitMs?: number;
  } = {},
): void {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let draining = false;
  const drain = (signal: "SIGTERM" | "SIGINT") => {
    if (draining) return;
    draining = true;
    const started = Date.now();
    const code = signal === "SIGINT" ? 130 : 143;
    console.info(
      JSON.stringify({ event: "server.draining", signal, work: state.count }),
    );
    const check = () => {
      const waited = Date.now() - started;
      if (state.count > 0 && waited < (options.limitMs ?? DRAIN_LIMIT_MS))
        return;
      clearInterval(timer);
      console.info(
        JSON.stringify({
          event: "server.drained",
          signal,
          work: state.count,
          ms: waited,
        }),
      );
      exit(code);
    };
    const timer = setInterval(check, options.pollMs ?? 250);
    check();
  };
  process.on("SIGTERM", () => drain("SIGTERM"));
  process.on("SIGINT", () => drain("SIGINT"));
}
