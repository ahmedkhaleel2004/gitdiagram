import "server-only";

import { spawn } from "node:child_process";

export interface RunProcessOptions {
  /** Written to stdin, which is then closed. */
  input?: Uint8Array;
  /** Collect stdout and resolve with it (otherwise it is discarded). */
  stdout?: boolean;
  /** Kills the process and rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Kills the process and rejects with a TimeoutError after this long. */
  timeoutMs?: number;
  /** Names the process in errors ("ffmpeg"). */
  label?: string;
}

/**
 * Runs a binary to completion. However it ends, nothing is left behind: a
 * process that exits early (so writing its stdin raises EPIPE) rejects rather
 * than crashing the server, and an abort or timeout kills it and waits for it
 * to be reaped before rejecting.
 */
export async function runProcess(
  binary: string,
  args: string[],
  options: RunProcessOptions = {},
): Promise<Buffer> {
  const label = options.label ?? "process";
  options.signal?.throwIfAborted();
  const stops = [
    options.signal,
    options.timeoutMs === undefined
      ? undefined
      : AbortSignal.timeout(options.timeoutMs),
  ].filter((signal): signal is AbortSignal => signal !== undefined);
  const stop = stops.length ? AbortSignal.any(stops) : undefined;

  const child = spawn(binary, args, {
    stdio: [
      options.input ? "pipe" : "ignore",
      options.stdout ? "pipe" : "ignore",
      "pipe",
    ],
  });
  const exited = new Promise<[number | null, NodeJS.Signals | null]>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once(
        "close",
        (code: number | null, signal: NodeJS.Signals | null) =>
          resolve([code, signal]),
      );
    },
  );
  // Writing to a process that has exited raises EPIPE on stdin; the exit code
  // reports the failure, so the stream error itself is not needed.
  child.stdin?.on("error", () => undefined);
  const chunks: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-2000);
  });
  const kill = () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  };
  stop?.addEventListener("abort", kill, { once: true });
  try {
    if (options.input) child.stdin?.end(options.input);
    const [code, signal] = await exited;
    if (stop?.aborted) throw stop.reason;
    if (code !== 0)
      throw new Error(`${label} failed (${code ?? signal}): ${stderr.trim()}`);
    return Buffer.concat(chunks);
  } finally {
    stop?.removeEventListener("abort", kill);
  }
}
