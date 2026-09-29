/**
 * Print the nodes and edges of saved eval graphs, one run per block.
 *
 *   bun experiments/diagram-evidence/show.ts <label> <owner__repo>
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const [label, prefix] = process.argv.slice(2);
const root = join("/tmp/eval-diagrams", label!);
for (const dir of (await readdir(root)).sort()) {
  if (prefix && !dir.startsWith(prefix)) continue;
  const context = JSON.parse(
    await readFile(join(root, dir, "context.json"), "utf8"),
  ) as { sourcePaths: string[] };
  console.info(`== ${dir}\nsources: ${context.sourcePaths.join(", ")}`);
  let graph: {
    nodes: Array<{ id: string; label: string; path: string | null }>;
    edges: Array<{
      from: string;
      to: string;
      label: string | null;
      style: string | null;
      evidencePath?: string | null;
      description?: string | null;
    }>;
  };
  try {
    graph = JSON.parse(await readFile(join(root, dir, "graph.json"), "utf8"));
  } catch {
    console.info("(no graph)");
    continue;
  }
  for (const node of graph.nodes)
    console.info(`N ${node.id} | ${node.label} | ${node.path ?? "-"}`);
  for (const edge of graph.edges)
    console.info(
      `E ${edge.from} -> ${edge.to} | ${edge.label ?? ""}${edge.style === "dashed" ? " (dashed)" : ""}${edge.evidencePath ? ` | ev: ${edge.evidencePath}` : ""}${edge.description ? ` | ${edge.description}` : ""}`,
    );
}
