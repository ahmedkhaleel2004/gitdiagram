/**
 * Parses and evaluates gitignore-style ignore patterns for filtering
 * files and directories during repository diagram generation.
 *
 * Supports:
 * - Empty lines and `#` comments
 * - Root-anchored patterns (leading `/` or `/` in middle)
 * - Directory patterns (trailing `/` or directory names)
 * - Glob wildcards (`*`, `**`, `?`)
 * - Negation patterns (`!`)
 */

interface IgnoreRule {
  raw: string;
  isNegation: boolean;
  regex: RegExp;
}

function globToRegex(glob: string): string {
  let result = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          result += "(?:.+/)?";
          i += 3;
        } else {
          result += ".*";
          i += 2;
        }
      } else {
        result += "[^/]*";
        i++;
      }
    } else if (c === "?") {
      result += "[^/]";
      i++;
    } else if (
      c === "." ||
      c === "+" ||
      c === "^" ||
      c === "$" ||
      c === "{" ||
      c === "}" ||
      c === "(" ||
      c === ")" ||
      c === "[" ||
      c === "]" ||
      c === "|" ||
      c === "\\"
    ) {
      result += `\\${c}`;
      i++;
    } else {
      result += c;
      i++;
    }
  }
  return result;
}

export function parseIgnorePatterns(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function compileRule(pattern: string): IgnoreRule | null {
  const trimmed = pattern.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const isNegation = trimmed.startsWith("!");
  let clean = isNegation ? trimmed.slice(1).trim() : trimmed;
  if (!clean) return null;

  const isRootAnchored = clean.startsWith("/");
  if (isRootAnchored) {
    clean = clean.slice(1);
  }

  const isDirectoryOnly = clean.endsWith("/");
  if (isDirectoryOnly) {
    clean = clean.slice(0, -1);
  }

  if (!clean) return null;

  // A pattern with a slash in the middle (like "foo/bar") is anchored to root
  const hasMiddleSlash = clean.includes("/");
  const anchorToRoot = isRootAnchored || hasMiddleSlash;

  const regexBody = globToRegex(clean);

  // If directory-only or could be a directory, match the path itself or anything underneath it
  const patternRegex = anchorToRoot
    ? `^${regexBody}(?:/.*)?$`
    : `(?:^|/)${regexBody}(?:/.*)?$`;

  return {
    raw: pattern,
    isNegation,
    regex: new RegExp(patternRegex, "u"),
  };
}

export function createPathFilter(
  patterns: readonly string[],
): (path: string) => boolean {
  const rules: IgnoreRule[] = [];
  for (const pattern of patterns) {
    const rule = compileRule(pattern);
    if (rule) {
      rules.push(rule);
    }
  }

  if (!rules.length) {
    return () => false;
  }

  return (path: string): boolean => {
    const normalized = path.replace(/^\/+/u, "").replace(/\/+$/u, "");
    let ignored = false;
    for (const rule of rules) {
      if (rule.regex.test(normalized)) {
        ignored = !rule.isNegation;
      }
    }
    return ignored;
  };
}
