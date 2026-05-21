import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { GithubData } from "~/server/generate/github";

const EXCLUDED_PATTERNS = [
  ".git/",
  ".claude/",
  ".codex/",
  ".gemini/",
  ".playwright-mcp/",
  ".pnpm-store/",
  ".pytest_cache/",
  ".worktrees/",
  ".vs/",
  "node_modules/",
  "vendor/",
  "venv/",
  "bin/",
  "obj/",
  ".next/",
  "dist/",
  "build/",
  "tmp/",
  "temp/",
  ".min.",
  ".pyc",
  ".pyo",
  ".pyd",
  ".so",
  ".dll",
  ".class",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".ico",
  ".svg",
  ".ttf",
  ".woff",
  ".webp",
  "__pycache__/",
  ".cache/",
  ".tmp/",
  "yarn.lock",
  "poetry.lock",
  "*.log",
  ".vscode/",
  ".idea/",
];

const DEFAULT_MAX_FILES = 2_000;
const DEFAULT_MAX_README_BYTES = 80_000;

function isLocalModeEnabled(): boolean {
  return process.env.LOCAL_MODE?.trim().toLowerCase() === "true";
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function shouldIncludeFile(relativePath: string): boolean {
  const lowerPath = `${relativePath.toLowerCase()}${relativePath.endsWith("/") ? "" : ""}`;
  return !EXCLUDED_PATTERNS.some((pattern) => {
    if (pattern === "*.log") return lowerPath.endsWith(".log");
    return lowerPath.includes(pattern);
  });
}

function getNumberEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function readReadme(root: string): Promise<string> {
  const maxBytes = getNumberEnv(
    "LOCAL_REPOSITORY_MAX_README_BYTES",
    DEFAULT_MAX_README_BYTES,
  );
  for (const filename of ["README.md", "README", "readme.md"]) {
    try {
      const fullPath = path.join(root, filename);
      const content = await readFile(fullPath);
      return content.subarray(0, maxBytes).toString("utf8");
    } catch {
      // Try the next conventional README name.
    }
  }
  return "";
}

async function collectFiles(
  root: string,
  current: string,
  files: string[],
  maxFiles: number,
) {
  if (files.length >= maxFiles) return;

  const entries = (await readdir(current, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    if (files.length >= maxFiles) return;

    const fullPath = path.join(current, entry.name);
    if (entry.name.startsWith(".")) {
      continue;
    }

    const relativePath = normalizeRelativePath(path.relative(root, fullPath));
    const comparablePath = entry.isDirectory()
      ? `${relativePath}/`
      : relativePath;

    if (!shouldIncludeFile(comparablePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      await collectFiles(root, fullPath, files, maxFiles);
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
}

export async function getLocalData(localPath: string): Promise<GithubData> {
  if (!isLocalModeEnabled()) {
    throw new Error(
      "Local repository generation is disabled. Set LOCAL_MODE=true.",
    );
  }

  const resolvedPath = path.resolve(localPath);
  const pathStat = await stat(resolvedPath);
  if (!pathStat.isDirectory()) {
    throw new Error("Local repository path must be a directory.");
  }

  const files: string[] = [];
  await collectFiles(
    resolvedPath,
    resolvedPath,
    files,
    getNumberEnv("LOCAL_REPOSITORY_MAX_FILES", DEFAULT_MAX_FILES),
  );

  return {
    defaultBranch: "local",
    fileTree: files.join("\n"),
    readme: await readReadme(resolvedPath),
    isPrivate: true,
    stargazerCount: null,
  };
}
