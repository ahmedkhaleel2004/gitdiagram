/** Preserve verbatim, line-numbered windows around architecture-bearing code.
 * Large service files often put initialization in the middle, beyond a simple
 * head/tail excerpt. Omissions are explicit and never imply absent behavior. */
export function excerptSource(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const lines = text.split("\n");
  const importedNames = new Set<string>();
  const imports: Array<{ names: string[]; source: string }> = [];
  for (const match of text.matchAll(
    /^[\t ]*import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/gm,
  )) {
    const names: string[] = [];
    for (const entry of match[1]!.split(",")) {
      if (/^\s*type\s/.test(entry)) continue;
      const name = entry
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .at(-1);
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) {
        importedNames.add(name);
        names.push(name);
      }
    }
    imports.push({ names, source: match[2]! });
  }
  for (const match of text.matchAll(
    /^[\t ]*import\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']/gm,
  )) {
    importedNames.add(match[1]!);
    imports.push({ names: [match[1]!], source: match[2]! });
  }
  const importBudget = imports.length
    ? Math.min(1000, Math.floor(budget / 4))
    : 0;
  const excerptBudget = budget - importBudget;
  const references = (line: string) => [
    ...[...line.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map(
      (match) => match[1]!,
    ),
    ...[...line.matchAll(/<([A-Z][\w$]*)(?=[\s/>])/g)].map(
      (match) => match[1]!,
    ),
  ];
  const callsImportedFunction = (line: string) =>
    references(line).some((name) => importedNames.has(name));
  const windows: Array<{ start: number; end: number; score: number }> = [
    { start: 0, end: Math.min(8, lines.length), score: 100 },
  ];
  lines.forEach((line, index) => {
    if (
      /(?:constructor\s*\(|\b(?:onCreate|__init__|main|setup|initialize|wsgi_app|full_dispatch_request|dispatch_request|handle_request|get_request_handler|run_endpoint_function|ServeHTTP|create_app|POST|GET|PUT|DELETE|PATCH)\s*\(|func\s+New\w*\s*\()/i.test(
        line,
      )
    ) {
      windows.push({
        start: Math.max(0, index - 2),
        end: Math.min(lines.length, index + 14),
        score: 90,
      });
    } else if (callsImportedFunction(line)) {
      const operation =
        /\b(?:await\s+)?(?:generate|compile|parse|render|search|retrieve|execute|query|encode|decode|serialize|dispatch|resolve|process|transform|load|save|persist|fetch|read|write)\w*\s*\(/i.test(
          line,
        );
      const bookkeeping =
        /(?:audit|timeline|telemetry|timing|quota|cancell|pricing|estimate|abort)/i.test(
          line,
        );
      windows.push({
        start: Math.max(0, index - 1),
        end: Math.min(lines.length, index + 7),
        score: bookkeeping
          ? 35
          : operation || /\bawait\s+\w+\s*\(|<[A-Z][\w$]*[\s/>]/.test(line)
            ? 110
            : 65,
      });
    } else if (
      /(?:\bnew\s+[A-Z]\w*|\bawait\s+|\.\s*(?:run|start|connect|register|dispatch|include|query|execute|invoke|create|index|retrieve|fetch|publish|send|add|use|mount)\w*\s*\()/i.test(
        line,
      )
    ) {
      windows.push({
        start: Math.max(0, index - 2),
        end: Math.min(lines.length, index + 5),
        score: 50,
      });
    }
  });
  // Sample across the file when architectural call sites are not recognizable
  // in its language, rather than pretending the unsampled body was inspected.
  for (let index = 0; index < lines.length; index += 30)
    windows.push({
      start: index,
      end: Math.min(lines.length, index + 20),
      score: 10,
    });
  const selected = new Set<number>();
  const regions = new Map<number, number>();
  let characters = 0;
  // Spread windows across the file. A score tie must not spend the entire
  // budget on early setup while hiding the actual workflow near the bottom.
  const regionFor = (start: number) =>
    Math.min(7, Math.floor((start / lines.length) * 8));
  const buckets = Array.from({ length: 8 }, () => [] as typeof windows);
  for (const window of windows) buckets[regionFor(window.start)]!.push(window);
  for (const bucket of buckets)
    bucket.sort((a, b) => b.score - a.score || a.start - b.start);
  const cursors = Array<number>(8).fill(0);
  while (true) {
    let bestRegion = -1;
    let bestPriority = -Infinity;
    for (let region = 0; region < buckets.length; region++) {
      const candidate = buckets[region]![cursors[region]!];
      if (!candidate) continue;
      const priority = candidate.score - 45 * (regions.get(region) ?? 0);
      if (priority > bestPriority) {
        bestRegion = region;
        bestPriority = priority;
      }
    }
    if (bestRegion === -1) break;
    const window = buckets[bestRegion]![cursors[bestRegion]!]!;
    cursors[bestRegion]!++;
    const missing = Array.from(
      { length: window.end - window.start },
      (_, i) => window.start + i,
    ).filter((index) => !selected.has(index));
    if (!missing.length) continue;
    const size =
      missing.reduce((sum, index) => sum + lines[index]!.length + 1, 0) + 50;
    if (characters + size > excerptBudget) continue;
    for (const index of missing) selected.add(index);
    characters += size;
    const region = regionFor(window.start);
    regions.set(region, (regions.get(region) ?? 0) + 1);
  }
  if (!selected.size)
    return `${text.slice(0, Math.max(0, budget - 40))}\n[remaining source omitted]`;
  const output: string[] = [];
  let previous = -2;
  for (const index of [...selected].sort((a, b) => a - b)) {
    if (index !== previous + 1)
      output.push(`[excerpt begins at line ${index + 1}; gaps omitted]`);
    output.push(lines[index]!);
    previous = index;
  }
  output.push("[end of excerpts; unsampled lines omitted]");
  const excerpt = output.join("\n");
  const calledNames = new Set(references(excerpt));
  const declarations: string[] = [];
  let importCharacters = 80;
  for (const entry of imports) {
    const names = entry.names.filter((name) => calledNames.has(name));
    if (!names.length) continue;
    const binding = `${names.join(", ")} from ${JSON.stringify(entry.source)}`;
    if (importCharacters + binding.length + 1 > importBudget) continue;
    declarations.push(binding);
    importCharacters += binding.length + 1;
  }
  // Preserve binding provenance when a selected call's import declaration is
  // outside its window. These are local binding names and literal module
  // specifiers from source declarations, not inferred calls or resolved paths.
  const provenance = declarations.length
    ? `[import bindings for calls below]\n${declarations.join("\n")}\n`
    : "";
  return `${provenance}${excerpt}`.slice(0, budget);
}
