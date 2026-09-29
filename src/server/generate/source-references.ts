import type { RepositoryPathType } from "./github";

// Which repository files a source file imports or names, found by reading its
// whole text (not only the excerpt the model sees). This is the deterministic
// half of edge evidence: the model is shown these lists, and an edge the model
// left uncited is given a citation only when one of them supports it. Nothing
// here is inferred from names alone except the class-per-file languages, where
// a type's name is its file's name.
export const MAX_REFERENCES_PER_FILE = 40;

const JS_SOURCE = /\.(?:[cm]?[jt]sx?|vue|svelte)$/i;
const JS_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".vue",
  ".svelte",
];
// Languages that name a file after the type it declares, so mentioning the
// type (even without an import, as in a C# namespace or a Java package) is a
// reference to that file.
const TYPE_FAMILIES: Record<string, RegExp> = {
  cs: /\.cs$/i,
  jvm: /\.(?:java|kts?|scala)$/i,
  swift: /\.swift$/i,
  php: /\.php$/i,
};
const TYPE_NAME = /^[A-Z][A-Za-z0-9]{2,}$/;

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

function stemOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

/** Join and normalize `.`/`..`; null when it climbs above the repository. */
function joinPath(base: string, relative: string): string | null {
  const parts = base ? base.split("/") : [];
  for (const part of relative.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

function familyOf(path: string): string | null {
  for (const [family, pattern] of Object.entries(TYPE_FAMILIES))
    if (pattern.test(path)) return family;
  return null;
}

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

export type ReferenceResolver = (path: string, text: string) => string[];

export function createReferenceResolver(
  pathTypes: ReadonlyMap<string, RepositoryPathType>,
): ReferenceResolver {
  const blobs = new Set<string>();
  const trees = new Set<string>();
  const byStem = new Map<string, string[]>();
  // Per language family: type name -> its only file (null when ambiguous).
  const typeFiles = new Map<string, Map<string, string | null>>();
  for (const [path, type] of pathTypes) {
    if (type === "tree") {
      trees.add(path);
      continue;
    }
    blobs.add(path);
    const stem = stemOf(path);
    const entries = byStem.get(stem);
    if (entries) entries.push(path);
    else byStem.set(stem, [path]);
    const family = familyOf(path);
    if (family && TYPE_NAME.test(stem) && /[a-z]/.test(stem)) {
      const names = typeFiles.get(family) ?? new Map<string, string | null>();
      typeFiles.set(family, names);
      names.set(stem, names.has(stem) ? null : path);
    }
  }

  /** The shortest repository path ending in `suffix` (a path boundary). */
  const bySuffix = (suffix: string): string | null => {
    const stem = stemOf(suffix);
    let best: string | null = null;
    for (const candidate of byStem.get(stem) ?? []) {
      if (candidate !== suffix && !candidate.endsWith(`/${suffix}`)) continue;
      if (!best || candidate.length < best.length) best = candidate;
    }
    return best;
  };

  const jsFile = (base: string): string | null => {
    if (blobs.has(base) && extensionOf(base)) return base;
    const swapped = base.replace(/\.(m|c)?js(x?)$/i, (_, kind = "", x) =>
      kind ? `.${kind}ts` : `.ts${x}`,
    );
    if (swapped !== base && blobs.has(swapped)) return swapped;
    for (const extension of JS_EXTENSIONS)
      if (blobs.has(`${base}${extension}`)) return `${base}${extension}`;
    for (const extension of JS_EXTENSIONS)
      if (blobs.has(`${base}/index${extension}`))
        return `${base}/index${extension}`;
    return null;
  };

  const resolveJs = (path: string, text: string, out: Set<string>) => {
    const directory = dirname(path);
    for (const match of text.matchAll(
      /(?:\bfrom|\bimport|\brequire\s*\()\s*\(?\s*["']([^"'\n]{1,300})["']/g,
    )) {
      const specifier = match[1]!;
      if (specifier.startsWith(".")) {
        const base = joinPath(directory, specifier);
        const file = base === null ? null : jsFile(base);
        if (file) out.add(file);
        continue;
      }
      const alias = /^[~@#]\/(.+)$/.exec(specifier)?.[1];
      if (alias) {
        const file = jsFile(`src/${alias}`) ?? jsFile(alias);
        if (file) out.add(file);
        continue;
      }
      // A scoped workspace package in a monorepo ("@trpc/server" in
      // packages/server): the reference is to its folder. Unscoped names are
      // skipped; "next" would wrongly match a repository's own packages/next.
      const bare = /^@[^/]+\/([^/]+)/.exec(specifier)?.[1];
      if (!bare) continue;
      for (const root of ["packages", "apps", "libs"]) {
        const folder = `${root}/${bare}`;
        if (trees.has(folder)) {
          out.add(folder);
          break;
        }
      }
    }
  };

  const pythonModule = (moduleName: string): string | null => {
    const relative = moduleName.replace(/\./g, "/");
    return bySuffix(`${relative}.py`) ?? bySuffix(`${relative}/__init__.py`);
  };

  const resolvePython = (path: string, text: string, out: Set<string>) => {
    const directory = dirname(path);
    for (const match of text.matchAll(
      /^[\t ]*from[\t ]+(\.*)([\w.]*)[\t ]+import[\t ]+(\([^)]*\)|[^\n#]+)/gm,
    )) {
      const dots = match[1]!.length;
      const moduleName = match[2]!;
      const names = match[3]!
        .replace(/[()]/g, "")
        .split(",")
        .map((name) => name.trim().split(/\s+/)[0]!)
        .filter((name) => /^\w+$/.test(name));
      if (dots) {
        let base: string | null = directory;
        for (let level = 1; level < dots && base !== null; level++)
          base = base ? dirname(base) : null;
        if (base === null) continue;
        const folder = moduleName
          ? joinPath(base, moduleName.replace(/\./g, "/"))
          : base;
        if (folder === null) continue;
        const file = blobs.has(`${folder}.py`)
          ? `${folder}.py`
          : blobs.has(`${folder}/__init__.py`)
            ? `${folder}/__init__.py`
            : null;
        let submodule = false;
        for (const name of names) {
          const child = blobs.has(`${folder}/${name}.py`)
            ? `${folder}/${name}.py`
            : blobs.has(`${folder}/${name}/__init__.py`)
              ? `${folder}/${name}/__init__.py`
              : null;
          if (child) {
            out.add(child);
            submodule = true;
          }
        }
        if (file && !submodule) out.add(file);
        continue;
      }
      let submodule = false;
      for (const name of names) {
        const child = pythonModule(`${moduleName}.${name}`);
        if (child) {
          out.add(child);
          submodule = true;
        }
      }
      const file = pythonModule(moduleName);
      if (file && !submodule) out.add(file);
    }
    for (const match of text.matchAll(/^[\t ]*import[\t ]+([^\n#]+)/gm)) {
      for (const entry of match[1]!.split(",")) {
        const moduleName = entry.trim().split(/\s+/)[0]!;
        if (!/^[\w.]+$/.test(moduleName)) continue;
        const file = pythonModule(moduleName);
        if (file) out.add(file);
      }
    }
  };

  const resolveRust = (path: string, text: string, out: Set<string>) => {
    const sourceRoot = /^(.*\/)?src\//.exec(path);
    const crateRoot = sourceRoot
      ? `${sourceRoot[1] ?? ""}src`
      : dirname(path) || "";
    const directory = dirname(path);
    const stem = stemOf(path);
    const selfDirectory = ["mod", "lib", "main"].includes(stem)
      ? directory
      : directory
        ? `${directory}/${stem}`
        : stem;
    const moduleFile = (base: string, segments: string[]) => {
      for (let length = segments.length; length > 0; length--) {
        const prefix = [base, ...segments.slice(0, length)]
          .filter(Boolean)
          .join("/");
        if (blobs.has(`${prefix}.rs`)) return `${prefix}.rs`;
        if (blobs.has(`${prefix}/mod.rs`)) return `${prefix}/mod.rs`;
      }
      return null;
    };
    const resolvePath = (anchor: string, rest: string[]) => {
      let base =
        anchor === "crate"
          ? crateRoot
          : anchor === "self"
            ? selfDirectory
            : dirname(selfDirectory);
      let segments = rest;
      while (segments[0] === "super") {
        base = dirname(base);
        segments = segments.slice(1);
      }
      const file = moduleFile(base, segments);
      if (file && file !== path) out.add(file);
    };
    for (const match of text.matchAll(
      /\b(crate|super|self)((?:::[A-Za-z_]\w*)*)::\{([^{}]*)\}/g,
    )) {
      const prefix = match[2]!.split("::").filter(Boolean);
      for (const item of match[3]!.split(",")) {
        const segments = /^\s*([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)/
          .exec(item)?.[1]
          ?.split("::");
        if (segments && segments[0] !== "self")
          resolvePath(match[1]!, [...prefix, ...segments]);
      }
      if (prefix.length) resolvePath(match[1]!, prefix);
    }
    for (const match of text.matchAll(
      /\b(crate|super|self)((?:::[A-Za-z_]\w*)+)/g,
    ))
      resolvePath(match[1]!, match[2]!.split("::").filter(Boolean));
    for (const match of text.matchAll(
      /^[\t ]*(?:pub(?:\([^)]*\))?[\t ]+)?mod[\t ]+([A-Za-z_]\w*)[\t ]*;/gm,
    )) {
      const file = moduleFile(selfDirectory, [match[1]!]);
      if (file) out.add(file);
    }
  };

  const resolveGo = (text: string, out: Set<string>) => {
    const imports: string[] = [];
    for (const match of text.matchAll(
      /^[\t ]*import[\t ]*(?:[\w.]+[\t ]+)?"([^"\n]+)"/gm,
    ))
      imports.push(match[1]!);
    for (const block of text.matchAll(/^[\t ]*import[\t ]*\(([\s\S]*?)\)/gm))
      for (const match of block[1]!.matchAll(/"([^"\n]+)"/g))
        imports.push(match[1]!);
    for (const specifier of imports) {
      const segments = specifier.split("/");
      // Only module paths (a domain first) can name this repository's
      // packages; the standard library ("net/http") never does.
      if (!segments[0]?.includes(".")) continue;
      for (let start = 1; start < segments.length; start++) {
        const folder = segments.slice(start).join("/");
        if (trees.has(folder)) {
          out.add(folder);
          break;
        }
      }
    }
  };

  const resolveJvm = (text: string, out: Set<string>) => {
    for (const match of text.matchAll(
      /^[\t ]*import[\t ]+(?:static[\t ]+)?([\w.]+)/gm,
    )) {
      const segments = match[1]!.split(".");
      for (const drop of [0, 1]) {
        const parts = segments.slice(0, segments.length - drop);
        if (parts.length < 2) continue;
        const relative = parts.join("/");
        const file =
          bySuffix(`${relative}.java`) ??
          bySuffix(`${relative}.kt`) ??
          bySuffix(`${relative}.scala`);
        if (file) {
          out.add(file);
          break;
        }
      }
    }
  };

  const resolveInclude = (path: string, text: string, out: Set<string>) => {
    for (const match of text.matchAll(
      /^[\t ]*#[\t ]*include[\t ]*"([^"\n]+)"/gm,
    )) {
      const relative = joinPath(dirname(path), match[1]!);
      if (relative && blobs.has(relative)) out.add(relative);
      else {
        const file = bySuffix(match[1]!.replace(/^(?:\.\.?\/)+/, ""));
        if (file) out.add(file);
      }
    }
  };

  const resolvePhp = (path: string, text: string, out: Set<string>) => {
    for (const match of text.matchAll(/^[\t ]*use[\t ]+([\w\\]+)/gm)) {
      const segments = match[1]!.split("\\").filter(Boolean);
      if (segments.length < 2) continue;
      const file = bySuffix(`${segments.slice(-2).join("/")}.php`);
      if (file) out.add(file);
    }
    for (const match of text.matchAll(
      /\b(?:require|include)(?:_once)?\s*\(?\s*(?:__DIR__\s*\.\s*)?["']([^"'\n]+\.php)["']/g,
    )) {
      const relative = joinPath(dirname(path), match[1]!);
      if (relative && blobs.has(relative)) out.add(relative);
    }
  };

  const resolveRuby = (path: string, text: string, out: Set<string>) => {
    for (const match of text.matchAll(
      /\brequire_relative\s*\(?\s*["']([^"'\n]+)["']/g,
    )) {
      const relative = joinPath(dirname(path), match[1]!);
      if (!relative) continue;
      const file = relative.endsWith(".rb") ? relative : `${relative}.rb`;
      if (blobs.has(file)) out.add(file);
    }
  };

  const resolveTypeNames = (path: string, text: string, out: Set<string>) => {
    const family = familyOf(path);
    const names = family ? typeFiles.get(family) : undefined;
    if (!names) return;
    const seen = new Set<string>();
    for (const match of withoutComments(text).matchAll(
      /\b[A-Z][A-Za-z0-9]{2,}\b/g,
    )) {
      const name = match[0];
      if (seen.has(name)) continue;
      seen.add(name);
      const file = names.get(name);
      if (file && file !== path) out.add(file);
    }
  };

  return (path, text) => {
    const out = new Set<string>();
    const extension = extensionOf(path);
    if (JS_SOURCE.test(path)) resolveJs(path, text, out);
    else if (extension === ".py") resolvePython(path, text, out);
    else if (extension === ".rs") resolveRust(path, text, out);
    else if (extension === ".go") resolveGo(text, out);
    else if (/^\.(?:c|cc|cpp|h|hpp)$/.test(extension))
      resolveInclude(path, text, out);
    else if (extension === ".rb") resolveRuby(path, text, out);
    if (TYPE_FAMILIES.jvm!.test(path)) resolveJvm(text, out);
    if (extension === ".php") resolvePhp(path, text, out);
    resolveTypeNames(path, text, out);
    out.delete(path);
    return [...out].slice(0, MAX_REFERENCES_PER_FILE);
  };
}
