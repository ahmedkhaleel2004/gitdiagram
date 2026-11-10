/** Full local copies of the eval repositories, for checking diagrams. */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { RepositoryPathType } from "~/server/generate/github";
import { isArchitectureSource } from "~/server/generate/repository-context";
import { createReferenceResolver } from "~/server/generate/source-references";

export const REPOS_ROOT = "/tmp/eval-repos";

export async function checkout(slug: string): Promise<string> {
  const dir = join(REPOS_ROOT, slug.replace("/", "__"));
  if (existsSync(dir)) return dir;
  await mkdir(dir, { recursive: true });
  const response = await fetch(
    `https://codeload.github.com/${slug}/tar.gz/HEAD`,
  );
  if (!response.ok) throw new Error(`${slug}: ${response.status}`);
  const archive = `${dir}.tar.gz`;
  await Bun.write(archive, await response.arrayBuffer());
  const tar = Bun.spawnSync([
    "tar",
    "-xzf",
    archive,
    "-C",
    dir,
    "--strip-components=1",
  ]);
  if (tar.exitCode !== 0) throw new Error(tar.stderr.toString());
  return dir;
}

export async function loadRepository(slug: string) {
  const dir = await checkout(slug);
  const pathTypes = new Map<string, RepositoryPathType>();
  const walk = async (relative: string) => {
    for (const entry of await readdir(join(dir, relative), {
      withFileTypes: true,
    })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        pathTypes.set(path, "tree");
        await walk(path);
      } else if (entry.isFile()) pathTypes.set(path, "blob");
    }
  };
  await walk("");
  const resolve = createReferenceResolver(pathTypes);
  const references = new Map<string, string[]>();
  const texts = new Map<string, string>();
  for (const [path, type] of pathTypes) {
    if (type !== "blob" || !isArchitectureSource(path)) continue;
    const full = join(dir, path);
    if ((await stat(full)).size > 512_000) continue;
    const text = await readFile(full, "utf8");
    texts.set(path, text);
    references.set(path, resolve(path, text));
  }
  return { dir, pathTypes, references, texts };
}
