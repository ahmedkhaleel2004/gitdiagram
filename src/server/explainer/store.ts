import "server-only";

import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { ENGINE_VERSION } from "~/features/explainer/engine";
import type { VideoArtifact } from "~/features/explainer/types";
import { readRequiredEnv } from "~/server/storage/config";
import {
  getBinaryObject,
  getJsonObject,
  hasObject,
  listObjects,
  presignObjectDownload,
  putBinaryObject,
  putJsonObject,
} from "~/server/storage/r2";

// Explainer videos live beside diagrams but under their own prefix, so they can
// never collide with or overwrite a diagram artifact. Everything a video
// references (narration clips, renders) sits under its own version folder, so a
// regenerated video never mixes with the files of the one it replaced and every
// file can be cached forever.
const segment = (value: string) =>
  encodeURIComponent(value.trim().toLowerCase());
const prefix = (username: string, repo: string) =>
  `video/v1/${segment(username)}/${segment(repo)}`;
const clipName = (index: number) =>
  `beat-${String(index).padStart(2, "0")}.mp3`;

export type RenderName =
  "landscape.mp4" | "vertical.mp4" | "poster.jpg" | "still.jpg";

// MP4s are drawn by the scene engine, so an engine change makes new ones: the
// engine version is part of their file names. Posters keep one name, since a
// slightly older still beats a missing link preview.
const renderFile = (name: RenderName) =>
  name.endsWith(".mp4")
    ? name.replace(/\.mp4$/, `.e${ENGINE_VERSION}.mp4`)
    : name;

/** A video's version is its creation time; it names the folder its files live in. */
export function videoVersion(createdAt: string): string | null {
  const ms = Date.parse(createdAt);
  return Number.isFinite(ms) ? String(ms) : null;
}

function versionedKey(
  username: string,
  repo: string,
  createdAt: string,
  name: string,
): string {
  const version = videoVersion(createdAt);
  if (!version) throw new Error("Invalid video version.");
  return `${prefix(username, repo)}/${version}/${name}`;
}

/** Local disk in development so testing never writes production storage. */
function videoStoreBackend(): "local" | "r2" {
  const configured = process.env.VIDEO_STORE?.trim();
  if (configured === "local" || configured === "r2") return configured;
  return process.env.NODE_ENV === "production" ? "r2" : "local";
}

const localPath = (key: string) => join(process.cwd(), ".video-cache", key);
const bucket = () => readRequiredEnv("R2_PUBLIC_BUCKET");

async function readLocal(key: string): Promise<Buffer | null> {
  try {
    return await readFile(localPath(key));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeLocal(key: string, body: Buffer | string) {
  const path = localPath(key);
  await mkdir(dirname(path), { recursive: true });
  // Write then rename so a reader never sees a half-written file.
  await writeFile(`${path}.tmp`, body);
  await rename(`${path}.tmp`, path);
}

async function readObject(key: string): Promise<Buffer | null> {
  return videoStoreBackend() === "local"
    ? readLocal(key)
    : getBinaryObject(bucket(), key);
}

export async function readVideoArtifact(
  username: string,
  repo: string,
): Promise<VideoArtifact | null> {
  const key = `${prefix(username, repo)}/artifact.json`;
  if (videoStoreBackend() === "local") {
    const body = await readLocal(key);
    return body ? (JSON.parse(body.toString("utf8")) as VideoArtifact) : null;
  }
  return getJsonObject<VideoArtifact>(bucket(), key);
}

export async function readVoiceClip(
  username: string,
  repo: string,
  createdAt: string,
  index: number,
): Promise<Buffer | null> {
  return readObject(versionedKey(username, repo, createdAt, clipName(index)));
}

/** Clips first, artifact last: the artifact is what makes a video visible. */
export async function writeVideo(artifact: VideoArtifact, clips: Buffer[]) {
  const { owner, repo } = artifact.meta;
  const clipKey = (index: number) =>
    versionedKey(owner, repo, artifact.createdAt, clipName(index));
  const artifactKey = `${prefix(owner, repo)}/artifact.json`;
  if (videoStoreBackend() === "local") {
    await Promise.all(
      clips.map((clip, index) => writeLocal(clipKey(index), clip)),
    );
    await writeLocal(artifactKey, JSON.stringify(artifact));
    return;
  }
  await Promise.all(
    clips.map((clip, index) =>
      putBinaryObject(bucket(), clipKey(index), clip, "audio/mpeg"),
    ),
  );
  await putJsonObject(bucket(), artifactKey, artifact);
}

export async function readRender(
  artifact: VideoArtifact,
  name: RenderName,
): Promise<Buffer | null> {
  const { owner, repo } = artifact.meta;
  return readObject(
    versionedKey(owner, repo, artifact.createdAt, renderFile(name)),
  );
}

export async function hasRender(
  artifact: VideoArtifact,
  name: RenderName,
): Promise<boolean> {
  const { owner, repo } = artifact.meta;
  const key = versionedKey(owner, repo, artifact.createdAt, renderFile(name));
  if (videoStoreBackend() === "local") {
    try {
      await stat(localPath(key));
      return true;
    } catch {
      return false;
    }
  }
  return hasObject(bucket(), key);
}

export async function writeRender(
  artifact: VideoArtifact,
  name: RenderName,
  body: Buffer,
) {
  const { owner, repo } = artifact.meta;
  const key = versionedKey(owner, repo, artifact.createdAt, renderFile(name));
  if (videoStoreBackend() === "local") return writeLocal(key, body);
  await putBinaryObject(
    bucket(),
    key,
    body,
    name.endsWith(".mp4") ? "video/mp4" : "image/jpeg",
  );
}

/**
 * Where a browser can download a render: a short-lived signed R2 URL in
 * production (large files never pass through a function), or null locally,
 * where the file route streams the bytes itself.
 */
export async function renderDownloadUrl(
  artifact: VideoArtifact,
  name: RenderName,
  filename: string,
): Promise<string | null> {
  if (videoStoreBackend() === "local") return null;
  const { owner, repo } = artifact.meta;
  return presignObjectDownload(
    bucket(),
    versionedKey(owner, repo, artifact.createdAt, renderFile(name)),
    { filename, expiresInSeconds: 60 * 60 },
  );
}

/** Every repository with a stored video, newest first (for the sitemap). */
export async function listStoredVideos(): Promise<
  Array<{ owner: string; repo: string; updatedAt: Date | null }>
> {
  const pattern = /^video\/v1\/([^/]+)\/([^/]+)\/artifact\.json$/;
  let objects: Array<{ key: string; lastModified: Date | null }>;
  if (videoStoreBackend() === "local") {
    const root = join(process.cwd(), ".video-cache", "video", "v1");
    const owners = await readdir(root).catch(() => [] as string[]);
    objects = (
      await Promise.all(
        owners.map(async (owner) =>
          (await readdir(join(root, owner)).catch(() => [] as string[])).map(
            (repo) => ({
              key: `video/v1/${owner}/${repo}/artifact.json`,
              lastModified: null,
            }),
          ),
        ),
      )
    ).flat();
  } else objects = await listObjects(bucket(), "video/v1/");
  return objects
    .flatMap((object) => {
      const match = pattern.exec(object.key);
      return match
        ? [
            {
              owner: decodeURIComponent(match[1]!),
              repo: decodeURIComponent(match[2]!),
              updatedAt: object.lastModified,
            },
          ]
        : [];
    })
    .sort(
      (a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0),
    );
}
