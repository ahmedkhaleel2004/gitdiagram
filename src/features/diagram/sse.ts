import type { DiagramStreamMessage } from "~/features/diagram/types";

export function parseSSEChunk<T = DiagramStreamMessage>(chunk: string): T[] {
  const messages: T[] = [];
  const lines = chunk.split(/\r?\n/);

  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const parsed = JSON.parse(payload) as T;
      messages.push(parsed);
    } catch {
      // Ignore malformed chunks.
    }
  }

  return messages;
}

export function parseSSEStreamBuffer<T = DiagramStreamMessage>(
  buffer: string,
): {
  messages: T[];
  remainder: string;
} {
  const messages: T[] = [];
  const normalized = buffer.replace(/\r\n/g, "\n");
  const rawEvents = normalized.split("\n\n");
  const remainder = rawEvents.pop() ?? "";

  for (const rawEvent of rawEvents) {
    if (!rawEvent.trim()) continue;
    messages.push(...parseSSEChunk<T>(rawEvent));
  }

  return { messages, remainder };
}

/**
 * Read a server-sent event body to its end and hand over each message:
 * decodes across chunk boundaries, flushes the decoder for a final event sent
 * without a blank line, and always lets go of the body. Returning `false` from
 * `onMessage` stops reading and cancels the rest of the stream; so does a
 * throw, which is passed on to the caller.
 *
 * Resolves `"stopped"` when the handler stopped early, else `"ended"`.
 */
export async function readSSEStream<T>(
  body: ReadableStream<Uint8Array>,
  onMessage: (message: T) => boolean | void | Promise<boolean | void>,
  onActivity?: () => void,
): Promise<"ended" | "stopped"> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deliver = async (messages: T[]) => {
    for (const message of messages) {
      if ((await onMessage(message)) === false) return false;
    }
    return true;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > 0) onActivity?.();
      buffer += decoder.decode(value, { stream: true });
      const { messages, remainder } = parseSSEStreamBuffer<T>(buffer);
      buffer = remainder;
      if (!(await deliver(messages))) {
        await reader.cancel().catch(() => undefined);
        return "stopped";
      }
    }
    buffer += decoder.decode();
    const { messages } = parseSSEStreamBuffer<T>(`${buffer}\n\n`);
    return (await deliver(messages)) ? "ended" : "stopped";
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
