import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { GenerationSessionAudit } from "../src/features/diagram/graph";
import { validateMermaidSyntax } from "../src/server/generate/mermaid";
import { updatePublicBrowseIndexForSuccessfulDiagram } from "../src/server/storage/diagram-state";
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

interface PreviewFile {
  generatedAt: string;
  provider: string;
  model: string;
  previews: Array<{
    username: string;
    repo: string;
    generatedAt: string;
    explanation: string;
    graph: NonNullable<DiagramArtifact["graph"]>;
    diagram: string;
  }>;
  failures: Array<{ username: string; repo: string; message: string }>;
}

const apply = process.argv.includes("--apply");
const restoreRoot = process.argv
  .find((argument) => argument.startsWith("--restore="))
  ?.slice("--restore=".length);
const timestamp = new Date()
  .toISOString()
  .replace(/[-:]/gu, "")
  .replace(/\.\d{3}Z$/u, "Z");
const backupRoot = `backups/example-diagrams/before-generated-pipeline/${timestamp}`;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function restoreArtifacts(root: string) {
  const prepared = [];

  for (const example of examples) {
    const location = getPublicLocation(example.username, example.repo);
    const backupKey = `${root}/${location.artifactKey}`;
    const artifact = await getJsonObject<DiagramArtifact>(
      location.bucket,
      backupKey,
    );
    if (!artifact) {
      throw new Error(`Missing rollback artifact at ${backupKey}.`);
    }
    prepared.push({ example, location, artifact, backupKey });
  }

  for (const entry of prepared) {
    await putJsonObject(
      entry.location.bucket,
      entry.location.artifactKey,
      entry.artifact,
    );
  }

  for (const entry of prepared) {
    const stored = await getJsonObject<DiagramArtifact>(
      entry.location.bucket,
      entry.location.artifactKey,
    );
    if (JSON.stringify(stored) !== JSON.stringify(entry.artifact)) {
      throw new Error(
        `Rollback verification failed for ${entry.example.username}/${entry.example.repo}.`,
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: "restored",
        backupRoot: root,
        examples: prepared.map(({ example, artifact }) => ({
          repo: `${example.username}/${example.repo}`,
          diagramSha: sha256(artifact.diagram),
        })),
      },
      null,
      2,
    ),
  );
}

async function main() {
  if (restoreRoot) {
    await restoreArtifacts(restoreRoot);
    return;
  }

  const previewFile = JSON.parse(
    await readFile("tmp/example-generation-previews/latest.json", "utf8"),
  ) as PreviewFile;
  if (previewFile.failures.length) {
    throw new Error(
      "The preview run contains failures and cannot be promoted.",
    );
  }

  const prepared = [];
  for (const example of examples) {
    const preview = previewFile.previews.find(
      (candidate) =>
        candidate.username === example.username &&
        candidate.repo === example.repo,
    );
    if (!preview) {
      throw new Error(
        `Missing preview for ${example.username}/${example.repo}.`,
      );
    }

    const validation = await validateMermaidSyntax(preview.diagram);
    if (!validation.valid) {
      throw new Error(
        `Invalid preview Mermaid for ${example.username}/${example.repo}: ${validation.message}`,
      );
    }

    const location = getPublicLocation(example.username, example.repo);
    const artifact = await getJsonObject<DiagramArtifact>(
      location.bucket,
      location.artifactKey,
    );
    if (!artifact) {
      throw new Error(
        `Missing current artifact for ${example.username}/${example.repo}.`,
      );
    }

    const latestSessionSummary: GenerationSessionAudit = {
      sessionId: `example-preview:${example.username}/${example.repo}:${preview.generatedAt}`,
      status: "succeeded",
      stage: "complete",
      provider: previewFile.provider,
      model: previewFile.model,
      graph: preview.graph,
      graphAttempts: [],
      stageUsages: [],
      timeline: [],
      createdAt: preview.generatedAt,
      updatedAt: preview.generatedAt,
    };
    const promotedArtifact: DiagramArtifact = {
      ...artifact,
      diagram: preview.diagram,
      explanation: preview.explanation,
      graph: preview.graph,
      generatedAt: preview.generatedAt,
      usedOwnKey: false,
      latestSessionSummary,
      lastSuccessfulAt: preview.generatedAt,
    };

    prepared.push({
      example,
      preview,
      location,
      artifact,
      promotedArtifact,
      backupKey: `${backupRoot}/${location.artifactKey}`,
    });
  }

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          provider: previewFile.provider,
          model: previewFile.model,
          backupRoot,
          examples: prepared.map(({ example, artifact, promotedArtifact }) => ({
            repo: `${example.username}/${example.repo}`,
            oldDiagramSha: sha256(artifact.diagram),
            newDiagramSha: sha256(promotedArtifact.diagram),
            oldNodes: artifact.graph?.nodes.length ?? null,
            newNodes: promotedArtifact.graph?.nodes.length ?? null,
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
        `Artifact changed during promotion preparation: ${entry.example.username}/${entry.example.repo}.`,
      );
    }
  }

  for (const entry of prepared) {
    await putJsonObject(entry.location.bucket, entry.backupKey, entry.artifact);
  }
  await putJsonObject(
    prepared[0]!.location.bucket,
    `${backupRoot}/manifest.json`,
    {
      version: 1,
      createdAt: new Date().toISOString(),
      purpose:
        "Rollback snapshot before promoting freshly generated example diagrams.",
      provider: previewFile.provider,
      model: previewFile.model,
      examples: prepared.map(
        ({ example, backupKey, artifact, promotedArtifact }) => ({
          repo: `${example.username}/${example.repo}`,
          backupKey,
          oldDiagramSha: sha256(artifact.diagram),
          promotedDiagramSha: sha256(promotedArtifact.diagram),
        }),
      ),
    },
  );

  const written: typeof prepared = [];
  try {
    for (const entry of prepared) {
      await putJsonObject(
        entry.location.bucket,
        entry.location.artifactKey,
        entry.promotedArtifact,
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
        "Example promotion failed and automatic rollback was incomplete.",
      );
    }
    throw error;
  }

  for (const entry of prepared) {
    const stored = await getJsonObject<DiagramArtifact>(
      entry.location.bucket,
      entry.location.artifactKey,
    );
    if (JSON.stringify(stored) !== JSON.stringify(entry.promotedArtifact)) {
      throw new Error(
        `Post-write verification failed for ${entry.example.username}/${entry.example.repo}.`,
      );
    }
  }

  const browseIndexErrors: string[] = [];
  for (const entry of prepared) {
    try {
      await updatePublicBrowseIndexForSuccessfulDiagram({
        username: entry.example.username,
        repo: entry.example.repo,
        lastSuccessfulAt: entry.promotedArtifact.lastSuccessfulAt,
        stargazerCount: entry.promotedArtifact.stargazerCount,
      });
    } catch (error) {
      browseIndexErrors.push(
        `${entry.example.username}/${entry.example.repo}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: "applied",
        backupRoot,
        restoreCommand: `bun scripts/promote-example-diagram-previews.ts --restore=${backupRoot}`,
        examples: prepared.map(({ example, promotedArtifact }) => ({
          repo: `${example.username}/${example.repo}`,
          diagramSha: sha256(promotedArtifact.diagram),
          nodes: promotedArtifact.graph?.nodes.length ?? null,
        })),
        browseIndexErrors,
      },
      null,
      2,
    ),
  );
}

await main();
