import type { DiagramStreamMessage } from "~/features/diagram/types";

export function parseSSEChunk(chunk: string): DiagramStreamMessage[] {
  const messages: DiagramStreamMessage[] = [];
  const lines = chunk.split(/\r?\n/);

  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const parsed = JSON.parse(payload) as DiagramStreamMessage;
      messages.push(parsed);
    } catch {
      // Ignore malformed chunks.
    }
  }

  return messages;
}

export function parseSSEStreamBuffer(buffer: string): {
  messages: DiagramStreamMessage[];
  remainder: string;
} {
  const messages: DiagramStreamMessage[] = [];
  const normalized = buffer.replace(/\r\n/g, "\n");
  const rawEvents = normalized.split("\n\n");
  const remainder = rawEvents.pop() ?? "";

  for (const rawEvent of rawEvents) {
    if (!rawEvent.trim()) continue;
    messages.push(...parseSSEChunk(rawEvent));
  }

  return { messages, remainder };
}
