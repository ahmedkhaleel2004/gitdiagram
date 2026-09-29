// Builds the diagram view that ChatGPT and other MCP Apps hosts show inline
// when get_repository_diagram runs (src/mcp-app/diagram-view.ts) into
// public/mcp-app/, where the ui:// resource in src/server/mcp/app.ts loads it
// from. Runs before `next build`; the output is generated, not committed.
//
// Mermaid loads each diagram type and the ELK layout on demand, so the build
// splits chunks: a view loads only what a flowchart needs.

import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const outdir = `${root}public/mcp-app`;

rmSync(outdir, { recursive: true, force: true });

const result = await build({
  absWorkingDir: root,
  entryPoints: { "diagram-view": "src/mcp-app/diagram-view.ts" },
  outdir,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  legalComments: "none",
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
  logLevel: "warning",
});

const bytes = Object.values(result.metafile.outputs).reduce(
  (total, output) => total + output.bytes,
  0,
);
console.log(
  `MCP app: ${Object.keys(result.metafile.outputs).length} files, ${(bytes / 1e6).toFixed(2)} MB → public/mcp-app/`,
);
