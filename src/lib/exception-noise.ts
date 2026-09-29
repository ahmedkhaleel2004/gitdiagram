import type { CaptureResult } from "posthog-js";

// Benign or foreign exceptions that bury the real ones in error tracking:
// - ResizeObserver: the browser skipped a resize notification for one frame.
// - "Object Not Found Matching Id": bots and in-app browsers (Outlook's link
//   scanner) rejecting promises with plain objects, never our code.
const NOISE = [
  /^ResizeObserver loop (completed with undelivered notifications|limit exceeded)/,
  /Object Not Found Matching Id:\d+/,
];

function exceptionMessages(properties: CaptureResult["properties"]): string[] {
  const messages: string[] = [];
  const list: unknown = properties.$exception_list;
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (entry && typeof entry === "object" && "value" in entry) {
        const { value } = entry as { value: unknown };
        if (typeof value === "string") messages.push(value);
      }
    }
  }
  const message: unknown = properties.$exception_message;
  if (typeof message === "string") messages.push(message);
  return messages;
}

/** Drops known-noise `$exception` events; every other event passes. */
export function dropNoiseExceptions(
  event: CaptureResult | null,
): CaptureResult | null {
  if (!event || event.event !== "$exception") return event;
  const messages = exceptionMessages(event.properties ?? {});
  if (
    messages.length > 0 &&
    messages.every((message) => NOISE.some((noise) => noise.test(message)))
  ) {
    return null;
  }
  return event;
}
