/** Preserve verbatim, line-numbered windows around architecture-bearing code.
 * Large service files often put initialization in the middle, beyond a simple
 * head/tail excerpt. Omissions are explicit and never imply absent behavior. */
export function excerptSource(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const lines = text.split("\n");
  const windows: Array<{ start: number; end: number; score: number }> = [
    { start: 0, end: Math.min(35, lines.length), score: 100 },
  ];
  lines.forEach((line, index) => {
    if (
      /(?:constructor\s*\(|\b(?:onCreate|__init__|main|setup|initialize|wsgi_app|full_dispatch_request|dispatch_request|handle_request|get_request_handler|run_endpoint_function|ServeHTTP|create_app|POST|GET|PUT|DELETE|PATCH)\s*\(|func\s+New\w*\s*\()/i.test(
        line,
      )
    ) {
      windows.push({
        start: Math.max(0, index - 2),
        end: Math.min(lines.length, index + 30),
        score: 90,
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
  let characters = 0;
  for (const window of windows.sort(
    (a, b) => b.score - a.score || a.start - b.start,
  )) {
    const missing = Array.from(
      { length: window.end - window.start },
      (_, i) => window.start + i,
    ).filter((index) => !selected.has(index));
    const size =
      missing.reduce((sum, index) => sum + lines[index]!.length + 1, 0) + 50;
    if (characters + size > budget) continue;
    for (const index of missing) selected.add(index);
    characters += size;
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
  return output.join("\n").slice(0, budget);
}
