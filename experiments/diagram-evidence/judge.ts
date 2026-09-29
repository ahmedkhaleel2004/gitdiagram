/**
 * Blind edge check: GPT-6 Sol reads, for every edge of a saved diagram, the
 * endpoint files' lines that mention the other side (plus up to two files in
 * the full repository that reference both sides, and README lines naming
 * both) and says whether the code shows the relationship. It never sees the
 * edge's style, its citation or which run produced it.
 *
 *   bun --conditions=react-server experiments/diagram-evidence/judge.ts <label> [repo-prefix]
 *
 * Writes /tmp/eval-diagrams/<label>/<run>/judge.json and appends spend.
 */
import { existsSync } from "node:fs";
import { appendFile, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  createCostSummary,
  normalizeGenerationUsage,
} from "~/server/generate/pricing";
import expected from "./expected.json";
import { loadRepository } from "./repos";

const [label, only] = process.argv.slice(2);
const MODEL = "gpt-6-sol";
const client = new OpenAI();

type Node = { id: string; label: string; path: string | null };
type Edge = { from: string; to: string; label: string | null };

const verdictSchema = z.object({
  verdicts: z.array(
    z.object({
      edge: z.number().int(),
      verdict: z.enum(["supported", "unsupported", "contradicted"]),
      reason: z.string(),
    }),
  ),
});

const inside = (path: string, folder: string) =>
  path === folder || path.startsWith(`${folder}/`);
const words = (node: Node) => {
  const stem = node.path
    ?.split("/")
    .at(-1)
    ?.replace(/\.[^.]+$/, "");
  return [
    ...(stem &&
    stem.length >= 3 &&
    !/^(?:mod|index|__init__|main|lib)$/.test(stem)
      ? [stem]
      : []),
    ...node.label
      .split(/[^A-Za-z0-9]+/)
      .filter((word) => word.length >= 4)
      .filter(
        (word) =>
          !/^(?:service|server|client|module|layer|runtime|handler|manager|system|component|data|store|core|external)$/i.test(
            word,
          ),
      ),
  ];
};

function focused(text: string, terms: string[], budget: number): string {
  const lines = text.split("\n");
  const pattern = terms.length
    ? new RegExp(
        terms
          .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("|"),
        "i",
      )
    : null;
  const keep = new Set<number>();
  for (let index = 0; index < Math.min(25, lines.length); index++)
    keep.add(index);
  if (pattern)
    lines.forEach((line, index) => {
      if (!pattern.test(line)) return;
      for (let near = index - 3; near <= index + 3; near++)
        if (near >= 0 && near < lines.length) keep.add(near);
    });
  const output: string[] = [];
  let previous = -2;
  let size = 0;
  for (const index of [...keep].sort((a, b) => a - b)) {
    const line = `${index + 1}: ${lines[index]!.slice(0, 240)}`;
    if (size + line.length > budget) {
      output.push("[...more matches omitted]");
      break;
    }
    if (index !== previous + 1) output.push("...");
    output.push(line);
    size += line.length + 1;
    previous = index;
  }
  return output.join("\n");
}

let spent = 0;
for (const slug of Object.keys(expected)) {
  const prefix = slug.replace("/", "__");
  if (only && !prefix.startsWith(only)) continue;
  const root = join("/tmp/eval-diagrams", label!);
  const runs = (await readdir(root)).filter((dir) =>
    dir.startsWith(`${prefix}__`),
  );
  if (!runs.length) continue;
  const repo = await loadRepository(slug);
  const readme =
    [...repo.pathTypes.keys()].find((path) => /^readme\.md$/i.test(path)) ??
    null;
  const readmeText = readme
    ? await readFile(join(repo.dir, readme), "utf8")
    : "";
  const filesOf = (path: string) =>
    [...repo.texts.keys()].filter((file) => inside(file, path)).slice(0, 40);
  for (const run of runs.sort()) {
    const dir = join(root, run);
    if (existsSync(join(dir, "judge.json"))) continue;
    let graph: { nodes: Node[]; edges: Edge[] };
    try {
      graph = JSON.parse(await readFile(join(dir, "graph.json"), "utf8"));
    } catch {
      continue;
    }
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const sections: string[] = [];
    graph.edges.forEach((edge, index) => {
      const a = nodes.get(edge.from)!;
      const b = nodes.get(edge.to)!;
      const parts = [
        `EDGE ${index}: "${a.label}" (${a.path ?? "external, no repository path"}) -> "${b.label}" (${b.path ?? "external, no repository path"}): ${edge.label ?? "(no label)"}`,
      ];
      const snippetFiles = new Map<string, string[]>();
      for (const [self, other] of [
        [a, b],
        [b, a],
      ] as const) {
        if (!self.path) continue;
        for (const file of filesOf(self.path).slice(0, 3))
          snippetFiles.set(file, [
            ...(snippetFiles.get(file) ?? []),
            ...words(other),
          ]);
      }
      if (a.path && b.path) {
        let wiring = 0;
        for (const [file, list] of repo.references) {
          if (wiring >= 2 || snippetFiles.has(file)) continue;
          if (
            list.some((target) => inside(target, a.path!)) &&
            list.some((target) => inside(target, b.path!))
          ) {
            snippetFiles.set(file, [...words(a), ...words(b)]);
            wiring++;
          }
        }
      }
      for (const [file, terms] of snippetFiles)
        parts.push(
          `--- ${file}\n${focused(repo.texts.get(file) ?? "", terms, 3500)}`,
        );
      const readmeLines = readmeText
        .split("\n")
        .filter((line) => {
          const lower = line.toLowerCase();
          return (
            words(a).some((word) => lower.includes(word.toLowerCase())) &&
            words(b).some((word) => lower.includes(word.toLowerCase()))
          );
        })
        .slice(0, 6);
      if (readmeLines.length)
        parts.push(`--- README lines naming both\n${readmeLines.join("\n")}`);
      sections.push(parts.join("\n"));
    });
    const response = await client.responses.parse({
      model: MODEL,
      reasoning: { effort: "medium" },
      input: [
        {
          role: "system",
          content:
            "You audit an architecture diagram of a code repository against its source. For each EDGE you get the endpoint files' lines that mention the other side (line-numbered, with gaps), sometimes files that reference both sides, and README lines naming both. Decide from this material only:\n- supported: the code or README shows this relationship between these two components (a call, import used at runtime, message, request, read/write, dispatch or documented flow), in the stated direction or as a clear request/response pair. External systems count when the endpoint's code talks to them.\n- unsupported: nothing shown establishes it; it looks inferred from names or folders.\n- contradicted: the material shows it is wrong (the component never touches the other, or something else does it).\nBe strict: a shared import of a type or a mention in a comment is not a runtime relationship. Return one verdict per edge.",
        },
        {
          role: "user",
          content: `Repository: ${slug}\n\n${sections.join("\n\n")}`,
        },
      ],
      text: { format: zodTextFormat(verdictSchema, "edge_verdicts") },
    });
    const usage = normalizeGenerationUsage(
      response.usage,
      response.service_tier,
    );
    const cost = usage
      ? createCostSummary({
          kind: "actual",
          model: MODEL,
          usage,
          approximate: false,
        }).amountUsd
      : 0;
    spent += cost;
    await appendFile(
      "/tmp/eval-diagrams/spend.jsonl",
      `${JSON.stringify({ label: `judge:${label}`, repo: slug, run, costUsd: cost, at: new Date().toISOString() })}\n`,
    );
    await writeFile(
      join(dir, "judge.json"),
      JSON.stringify(response.output_parsed, null, 2),
    );
    const verdicts = response.output_parsed?.verdicts ?? [];
    console.info(
      `${run}: ${verdicts.filter((v) => v.verdict === "supported").length} supported, ${verdicts.filter((v) => v.verdict === "unsupported").length} unsupported, ${verdicts.filter((v) => v.verdict === "contradicted").length} contradicted of ${graph.edges.length}; $${cost.toFixed(3)}`,
    );
  }
}
console.info(`judge spend $${spent.toFixed(3)}`);
