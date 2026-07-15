import { modernizeLegacyMermaidSource } from "../src/features/diagram/mermaid-modernize";
import { validateMermaidSyntax } from "../src/server/generate/mermaid";
import { getPublicLocation } from "../src/server/storage/cache-key";
import { getJsonObject, putJsonObject } from "../src/server/storage/r2";
import type { DiagramArtifact } from "../src/server/storage/types";

const examples = [
  { username: "fastapi", repo: "fastapi" },
  { username: "streamlit", repo: "streamlit" },
  { username: "pallets", repo: "flask" },
  { username: "tom-draper", repo: "api-analytics" },
  { username: "monkeytypegame", repo: "monkeytype" },
] as const;

const apply = process.argv.includes("--apply");
const restoreRoot = process.argv
  .find((argument) => argument.startsWith("--restore="))
  ?.slice("--restore=".length);
const timestamp = new Date()
  .toISOString()
  .replace(/[-:]/gu, "")
  .replace(/\.\d{3}Z$/u, "Z");
const backupRoot = `migration-backups/example-mermaid-modernization/${timestamp}`;

function extractClickUrls(source: string): string[] {
  return Array.from(
    source.matchAll(
      /^\s*click\s+[A-Za-z_][A-Za-z0-9_-]*\s+"(https:\/\/github\.com\/[^"\s]+)"\s*$/gmu,
    ),
    (match) => match[1] ?? "",
  );
}

async function main() {
  if (restoreRoot) {
    for (const example of examples) {
      const location = getPublicLocation(example.username, example.repo);
      const backupKey = `${restoreRoot}/${location.artifactKey}`;
      const backup = await getJsonObject<DiagramArtifact>(
        location.bucket,
        backupKey,
      );
      if (!backup) {
        throw new Error(`Missing migration backup at ${backupKey}.`);
      }
      await putJsonObject(location.bucket, location.artifactKey, backup);
    }

    console.log(
      JSON.stringify(
        {
          mode: "restored",
          backupRoot: restoreRoot,
          examples: examples.map(({ username, repo }) => `${username}/${repo}`),
        },
        null,
        2,
      ),
    );
    return;
  }

  const prepared = [];

  for (const example of examples) {
    const location = getPublicLocation(example.username, example.repo);
    const artifact = await getJsonObject<DiagramArtifact>(
      location.bucket,
      location.artifactKey,
    );
    if (!artifact) {
      throw new Error(
        `Missing artifact for ${example.username}/${example.repo}.`,
      );
    }

    const modernization = modernizeLegacyMermaidSource(artifact.diagram);
    const beforeClickUrls = extractClickUrls(artifact.diagram);
    const afterClickUrls = extractClickUrls(modernization.source);
    if (JSON.stringify(afterClickUrls) !== JSON.stringify(beforeClickUrls)) {
      throw new Error(
        `Click URLs changed for ${example.username}/${example.repo}.`,
      );
    }

    const validation = await validateMermaidSyntax(modernization.source);
    if (!validation.valid) {
      throw new Error(
        `Modernized Mermaid is invalid for ${example.username}/${example.repo}: ${validation.message}`,
      );
    }

    prepared.push({
      example,
      location,
      artifact,
      migratedArtifact: { ...artifact, diagram: modernization.source },
      modernization,
      backupKey: `${backupRoot}/${location.artifactKey}`,
    });
  }

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          examples: prepared.map(({ example, modernization }) => ({
            repo: `${example.username}/${example.repo}`,
            changed: modernization.changed,
            nodes: modernization.nodeCount,
            groups: modernization.groupCount,
            clicks: modernization.clickCount,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  for (const entry of prepared) {
    const current = await getJsonObject<DiagramArtifact>(
      entry.location.bucket,
      entry.location.artifactKey,
    );
    if (JSON.stringify(current) !== JSON.stringify(entry.artifact)) {
      throw new Error(
        `Artifact changed during migration preparation: ${entry.example.username}/${entry.example.repo}.`,
      );
    }
  }

  for (const entry of prepared) {
    await putJsonObject(entry.location.bucket, entry.backupKey, entry.artifact);
  }

  const written: typeof prepared = [];
  try {
    for (const entry of prepared) {
      await putJsonObject(
        entry.location.bucket,
        entry.location.artifactKey,
        entry.migratedArtifact,
      );
      written.push(entry);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const entry of written.reverse()) {
      try {
        await putJsonObject(
          entry.location.bucket,
          entry.location.artifactKey,
          entry.artifact,
        );
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }

    if (rollbackErrors.length) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Example Mermaid migration failed and rollback was incomplete.",
      );
    }
    throw error;
  }

  for (const entry of prepared) {
    const stored = await getJsonObject<DiagramArtifact>(
      entry.location.bucket,
      entry.location.artifactKey,
    );
    if (JSON.stringify(stored) !== JSON.stringify(entry.migratedArtifact)) {
      throw new Error(
        `Post-write verification failed for ${entry.example.username}/${entry.example.repo}.`,
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: "applied",
        backupRoot,
        examples: prepared.map(({ example, modernization, backupKey }) => ({
          repo: `${example.username}/${example.repo}`,
          nodes: modernization.nodeCount,
          groups: modernization.groupCount,
          clicks: modernization.clickCount,
          backupKey,
        })),
      },
      null,
      2,
    ),
  );
}

await main();
