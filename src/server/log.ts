import "server-only";

/** An error as a short log-safe string. */
export function errorText(error: unknown, max = 200): string {
  return error instanceof Error ? error.message.slice(0, max) : "unknown";
}

type Level = "info" | "warn" | "error";

/** One structured log line: `{"event": ..., ...fields}`. */
export function logEvent(
  level: Level,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  console[level](JSON.stringify({ event, ...fields }));
}
