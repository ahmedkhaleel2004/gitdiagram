import type { ReactNode } from "react";

// A small, safe Markdown subset: no HTML, remote assets or syntax highlighter.
// Source offsets identify append-only text without remounting on each token.
// Shared by the live notes (client) and the repository readout (server).
function inlineText(text: string): ReactNode[] {
  return Array.from(
    text.matchAll(/`[^`]+`|\*\*[^*]+\*\*|[^`*]+|[`*]/g),
    (match) => {
      const part = match[0];
      if (part.startsWith("`") && part.endsWith("`")) {
        return <code key={match.index}>{part.slice(1, -1)}</code>;
      }
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={match.index}>{inlineText(part.slice(2, -2))}</strong>
        );
      }
      return part;
    },
  );
}

/** One element per non-empty line: headings get `headingClassName`. */
export function architectureLines(
  text: string,
  headingClassName?: string,
): ReactNode[] {
  return Array.from(text.matchAll(/[^\n]+/g), (match) => {
    const line = match[0];
    if (!line.trim()) return null;
    if (/^#{1,6}\s/.test(line)) {
      return (
        <p className={headingClassName} key={match.index}>
          {inlineText(line.replace(/^#{1,6}\s+/, ""))}
        </p>
      );
    }
    return (
      <p key={match.index}>{inlineText(line.replace(/^[-*]\s+/, "• "))}</p>
    );
  });
}
