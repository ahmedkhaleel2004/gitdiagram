const safeGitHubClickDirective =
  /^\s*click\s+node_[a-z][a-z0-9_]*\s+"https:\/\/github\.com\/[^"\s]+"\s*$/u;

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
    if (trimmed.startsWith("click ") && !safeGitHubClickDirective.test(line)) {
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
