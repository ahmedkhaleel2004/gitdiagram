/**
 * Runs once when the server starts. In a container the server finishes the
 * renders and videos in flight before it exits on SIGTERM (see
 * src/server/drain.ts); the Dockerfile opts in with NEXT_MANUAL_SIG_HANDLE.
 */
export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_MANUAL_SIG_HANDLE
  ) {
    const { drainOnSignals } = await import("~/server/drain");
    drainOnSignals();
  }
}
