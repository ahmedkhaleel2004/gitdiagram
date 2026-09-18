import { z } from "zod";
import { diagramGraphSchema } from "~/features/diagram/graph";

// Keep the human-readable overview first so it can stream before graph JSON.
export const architectureOutputSchema = z.object({
  explanation: z.string().trim().min(1),
  graph: diagramGraphSchema,
});

/** Decode only the leading explanation string; never expose partial graph JSON.
 * An incomplete escape stays buffered until the next chunk. Final acceptance
 * still requires the complete response to pass architectureOutputSchema. */
export function readArchitectureProgress(raw: string): {
  text: string;
  complete: boolean;
} {
  const prefix = /^\s*\{\s*"explanation"\s*:\s*"/.exec(raw);
  if (!prefix) return { text: "", complete: false };
  const start = prefix[0].length - 1;
  let end = start + 1;
  let complete = false;
  while (end < raw.length) {
    const character = raw[end];
    if (character === '"') {
      complete = true;
      break;
    }
    if (character === "\\") {
      const length = raw[end + 1] === "u" ? 6 : 2;
      if (end + length > raw.length) break;
      end += length;
    } else end++;
  }
  try {
    return {
      text: JSON.parse(`${raw.slice(start, end)}"`) as string,
      complete,
    };
  } catch {
    return { text: "", complete: false };
  }
}
