/**
 * Deterministic scores for saved eval diagrams:
 * - coverage: expected core modules (expected.json) that some node points at
 *   (the file itself, or a folder at most two levels above it);
 * - static support: edges between two repository nodes that the WHOLE
 *   repository's import/name references connect (either direction), computed
 *   from a full local copy, not from what the model was shown;
 * - citations: edges carrying an evidence path.
 *
 *   bun --conditions=react-server experiments/diagram-haiku/score.ts <arm> <arm> ...
 *
 * Copy of experiments/diagram-evidence/score.ts reading this experiment's out/.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import expected from "./expected.json";
import { loadRepository } from "./repos";

type Graph = {
  nodes: Array<{ id: string; label: string; path: string | null }>;
  edges: Array<{
    from: string;
    to: string;
    style: string | null;
    evidencePath?: string | null;
  }>;
};

const labels = process.argv.slice(2);
const depth = (path: string) => path.split("/").length;
const inside = (path: string, folder: string) =>
  path === folder || path.startsWith(`${folder}/`);

const rows: Array<Record<string, string | number>> = [];
for (const [slug, modules] of Object.entries(expected)) {
  const repo = await loadRepository(slug);
  const prefix = slug.replace("/", "__");
  for (const label of labels) {
    const root = join(import.meta.dir, "out", "runs", label);
    const runs = (await readdir(root).catch(() => [])).filter((dir) =>
      dir.startsWith(`${prefix}__`),
    );
    for (const run of runs.sort()) {
      let graph: Graph;
      try {
        graph = JSON.parse(
          await readFile(join(root, run, "graph.json"), "utf8"),
        );
      } catch {
        continue;
      }
      const covered = modules.filter((module) =>
        graph.nodes.some(
          (node) =>
            node.path &&
            (node.path === module ||
              inside(node.path, module) ||
              (inside(module, node.path) &&
                depth(node.path) >= depth(module) - 2)),
        ),
      );
      const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
      const connects = (a: string, b: string) => {
        if (a === b) return true;
        for (const [file, list] of repo.references) {
          if (!inside(file, a)) continue;
          if (list.some((target) => inside(target, b) || inside(b, target)))
            return true;
        }
        return false;
      };
      let internal = 0;
      let supported = 0;
      for (const edge of graph.edges) {
        const a = nodes.get(edge.from)?.path;
        const b = nodes.get(edge.to)?.path;
        if (!a || !b) continue;
        internal++;
        if (connects(a, b) || connects(b, a)) supported++;
      }
      rows.push({
        repo: slug,
        label,
        run,
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        dashed: graph.edges.filter((edge) => edge.style === "dashed").length,
        cited: graph.edges.filter((edge) => edge.evidencePath).length,
        coverage: `${covered.length}/${modules.length}`,
        covered: covered.length,
        modules: modules.length,
        internal,
        staticSupported: supported,
        missing: modules
          .filter((module) => !covered.includes(module))
          .join(" "),
      });
    }
  }
}
await writeFile(
  join(import.meta.dir, "out", "score.json"),
  JSON.stringify(rows, null, 2),
);
for (const row of rows)
  console.info(
    `${row.label}\t${row.run}\tnodes ${row.nodes}\tedges ${row.edges}\tdashed ${row.dashed}\tcited ${row.cited}\tcoverage ${row.coverage}\tstatic ${row.staticSupported}/${row.internal}\tmissing: ${row.missing}`,
  );
