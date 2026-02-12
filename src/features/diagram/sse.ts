import type { DiagramStreamMessage } from "~/features/diagram/types";

export function parseSSEChunk(chunk: string): DiagramStreamMessage[] {
  const messages: DiagramStreamMessage[] = [];
  const lines = chunk.split("\n");

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (!payload) continue;

    try {
      const parsed = JSON.parse(payload) as DiagramStreamMessage;
      messages.push(parsed);
    } catch {
      // Ignore malformed partial chunks from network boundaries.
    }
  }

  return messages;
}
