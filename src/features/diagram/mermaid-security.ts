const safeGitHubClickDirective =
  /^\s*click\s+[a-z_][a-z0-9_-]*\s+"https:\/\/github\.com\/[^"\s]+"\s*$/iu;

// Mermaid's lexer tokenizes `click` followed by ANY whitespace run (tab, or
// even a newline — making a bare "click" line continue onto the next line), so
// detection must not assume the single-space form the compiler emits.
const clickDirectiveStart = /^click(\s|$)/u;

export function sanitizeMermaidSourceForRender(source: string): string {
  const lines: string[] = [];
  let insideConfigDirective = false;

  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (insideConfigDirective) {
      insideConfigDirective = !trimmed.includes("}%%");
      continue;
    }
    if (trimmed.startsWith("%%{")) {
      insideConfigDirective = !trimmed.includes("}%%");
      continue;
    }
    if (
      clickDirectiveStart.test(trimmed) &&
      !safeGitHubClickDirective.test(line)
    ) {
      continue;
    }
    lines.push(line);
  }

  return lines.join("\n");
}

export function enforceSafeMermaidLinks(root: ParentNode): void {
  for (const anchor of root.querySelectorAll("a")) {
    const rawHref =
      anchor.getAttribute("href") ?? anchor.getAttribute("xlink:href") ?? "";

    try {
      const url = new URL(rawHref, window.location.origin);
      if (url.protocol !== "https:" || url.hostname !== "github.com") {
        anchor.removeAttribute("href");
        anchor.removeAttribute("xlink:href");
        continue;
      }

      anchor.setAttribute("href", url.toString());
      anchor.removeAttribute("xlink:href");
      anchor.setAttribute("rel", "noopener noreferrer");
    } catch {
      anchor.removeAttribute("href");
      anchor.removeAttribute("xlink:href");
    }
  }
}
