import { z } from "zod";
import {
  diagramGraphSchema,
  type DiagramGraph,
} from "~/features/diagram/graph";

// Ask the model only for information used by the map. Repeated descriptions
// and generic type captions consumed tokens without improving the diagram.
const architectureGraphSchema = z.object({
  groups: z
    .array(
      diagramGraphSchema.shape.groups.element.pick({ id: true, label: true }),
    )
    .max(10),
  nodes: z
    .array(
      diagramGraphSchema.shape.nodes.element.omit({
        type: true,
        description: true,
      }),
    )
    .min(1)
    .max(34),
  edges: z
    .array(diagramGraphSchema.shape.edges.element.omit({ description: true }))
    .max(48),
});

// Keep the human-readable overview first so it can stream before graph JSON.
export const architectureOutputSchema = z.object({
  explanation: z.string().trim().min(1),
  graph: architectureGraphSchema,
});

/** Preserve the stored graph/compiler contract for old and new generations. */
export function expandArchitectureGraph(
  graph: z.infer<typeof architectureGraphSchema>,
): DiagramGraph {
  return {
    groups: graph.groups.map((group) => ({ ...group, description: null })),
    nodes: graph.nodes.map((node) => ({
      ...node,
      type: "component",
      description: null,
    })),
    edges: graph.edges.map((edge) => ({ ...edge, description: null })),
  };
}

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
