// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getLocalData } from "~/server/generate/local";

let tempDir: string | null = null;

afterEach(async () => {
  delete process.env.LOCAL_MODE;
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("getLocalData", () => {
  it("requires local mode", async () => {
    await expect(getLocalData(process.cwd())).rejects.toThrow(
      "Local repository generation is disabled",
    );
  });

  it("reads a local file tree and excludes generated folders", async () => {
    process.env.LOCAL_MODE = "true";
    tempDir = await mkdtemp(join(tmpdir(), "gitdiagram-local-"));
    await mkdir(join(tempDir, "src"));
    await mkdir(join(tempDir, "node_modules"));
    await writeFile(join(tempDir, "README.md"), "# Demo");
    await writeFile(join(tempDir, "src", "index.ts"), "export {};");
    await writeFile(join(tempDir, "node_modules", "ignored.js"), "");

    const data = await getLocalData(tempDir);

    expect(data.defaultBranch).toBe("local");
    expect(data.readme).toBe("# Demo");
    expect(data.fileTree).toContain("src/index.ts");
    expect(data.fileTree).not.toContain("node_modules/ignored.js");
    expect(data.isPrivate).toBe(true);
  });
});
