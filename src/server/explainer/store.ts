import "server-only";

import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, sep } from "node:path";
import { ENGINE_VERSION } from "~/features/explainer/engine";
import { PICTURE_ID, type VideoArtifact } from "~/features/explainer/types";
import { readRequiredEnv } from "~/server/storage/config";
import {
  deleteObject,
  getBinaryObject,
  getJsonObject,
  getObjectInfo,
  hasObject,
  listObjects,
  presignObjectDownload,
  putBinaryObject,
  putJsonObject,
} from "~/server/storage/r2";
import { purgeVideoResponse } from "./cache";
import { indexVideo } from "./video-index";

// Explainer videos live beside diagrams but under their own prefix, so they can
// never collide with or overwrite a diagram artifact. Everything a video
// references (narration clips, renders) sits under its own version folder, so a
// regenerated video never mixes with the files of the one it replaced and every
// file can be cached forever. The version a regeneration replaced keeps its
// files until the next one, so a tab that still has it open plays and
// downloads on; older versions and renders drawn by an older engine are
// deleted (see pruneVideoFiles).
const segment = (value: string) =>
  encodeURIComponent(value.trim().toLowerCase());
const prefix = (username: string, repo: string) =>
  `video/v1/${segment(username)}/${segment(repo)}`;
const clipName = (index: number) =>
  `beat-${String(index).padStart(2, "0")}.mp3`;
const pictureName = (id: string) => `picture-${id}.webp`;

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
export function videoStoreBackend(): "local" | "r2" {
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
  // Write then rename so a reader never sees a half-written file; the temp
  // name is unique, so two writes of one file never share it.
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, body);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
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

/** A README picture stored with a video (WebP), by id. */
export async function readPicture(
  username: string,
  repo: string,
  createdAt: string,
  id: string,
): Promise<Buffer | null> {
  if (!PICTURE_ID.test(id)) return null;
  return readObject(versionedKey(username, repo, createdAt, pictureName(id)));
}

/**
 * Clips and pictures first, artifact last: the artifact is what makes a video
 * visible. Then the CDN's copy of the old answer is dropped, and only after
 * that are files pruned, so nothing cached points at a deleted file.
 */
export async function writeVideo(
  artifact: VideoArtifact,
  clips: Buffer[],
  pictures: Array<{ id: string; bytes: Buffer }> = [],
) {
  const { owner, repo } = artifact.meta;
  const clipKey = (index: number) =>
    versionedKey(owner, repo, artifact.createdAt, clipName(index));
  const pictureKey = (id: string) =>
    versionedKey(owner, repo, artifact.createdAt, pictureName(id));
  const artifactKey = `${prefix(owner, repo)}/artifact.json`;
  if (videoStoreBackend() === "local") {
    await Promise.all([
      ...clips.map((clip, index) => writeLocal(clipKey(index), clip)),
      ...pictures.map((p) => writeLocal(pictureKey(p.id), p.bytes)),
    ]);
    await writeLocal(artifactKey, JSON.stringify(artifact));
  } else {
    await Promise.all([
      ...clips.map((clip, index) =>
        putBinaryObject(bucket(), clipKey(index), clip, "audio/mpeg"),
      ),
      ...pictures.map((p) =>
        putBinaryObject(bucket(), pictureKey(p.id), p.bytes, "image/webp"),
      ),
    ]);
    await putJsonObject(bucket(), artifactKey, artifact);
    await indexVideo(artifact);
    await purgeVideoResponse(owner, repo);
  }
  await pruneVideoFiles(artifact);
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

/**
 * When a stored render was last written (ms), or null if it does not exist.
 * A poster can be remade under the same name, so its URLs carry this stamp:
 * each remake gets a fresh URL past every cache that kept the old one.
 */
export async function renderStamp(
  artifact: VideoArtifact,
  name: RenderName,
): Promise<number | null> {
  const { owner, repo } = artifact.meta;
  const key = versionedKey(owner, repo, artifact.createdAt, renderFile(name));
  if (videoStoreBackend() === "local") {
    const info = await stat(localPath(key)).catch(() => null);
    return info ? Math.round(info.mtimeMs) : null;
  }
  const info = await getObjectInfo(bucket(), key);
  if (!info) return null;
  return info.lastModified?.getTime() ?? Date.parse(artifact.createdAt);
}

export async function writeRender(
  artifact: VideoArtifact,
  name: RenderName,
  body: Buffer,
) {
  const { owner, repo } = artifact.meta;
  const key = versionedKey(owner, repo, artifact.createdAt, renderFile(name));
  if (videoStoreBackend() === "local") await writeLocal(key, body);
  else
    await putBinaryObject(
      bucket(),
      key,
      body,
      name.endsWith(".mp4") ? "video/mp4" : "image/jpeg",
    );
  // A new MP4 replaces any drawn by an older engine.
  if (name.endsWith(".mp4")) await pruneVideoFiles(artifact);
}

/**
 * Files a video no longer needs: the folders of versions older than the one
 * it replaced (that one stays, so tabs still showing it keep working until
 * the next regeneration) and current renders drawn by an older engine. Only
 * older files are named, so a server still running an older release during a
 * deploy never deletes a newer one's files.
 */
export function staleVideoKeys(
  keys: string[],
  artifact: VideoArtifact,
): string[] {
  const version = videoVersion(artifact.createdAt);
  if (!version) return [];
  const root = `${prefix(artifact.meta.owner, artifact.meta.repo)}/`;
  const engine = Number(ENGINE_VERSION);
  const files = keys.flatMap((key) => {
    if (!key.startsWith(root)) return [];
    const [folder, name, ...rest] = key.slice(root.length).split("/");
    if (!name || rest.length > 0 || !/^\d+$/.test(folder!)) return [];
    return [{ key, folder: folder!, name }];
  });
  // The newest version older than this one: the one it replaced.
  const previous = Math.max(
    -1,
    ...files
      .map((file) => Number(file.folder))
      .filter((folder) => folder < Number(version)),
  );
  return files
    .filter(({ folder, name }) => {
      if (folder !== version)
        return Number(folder) < Number(version) && Number(folder) !== previous;
      const drawn = /\.e(\d+)\.(mp4|jpg)$/.exec(name);
      if (!drawn) return false;
      // Posters no longer carry an engine version, so any that does is left over.
      return drawn[2] === "jpg"
        ? Number(drawn[1]) <= engine
        : Number(drawn[1]) < engine;
    })
    .map(({ key }) => key);
}

async function listVideoKeys(root: string): Promise<string[]> {
  if (videoStoreBackend() === "r2")
    return (await listObjects(bucket(), root)).map((object) => object.key);
  const entries = await readdir(localPath(root), { recursive: true }).catch(
    () => [] as string[],
  );
  return entries.map((entry) => `${root}${entry.split(sep).join("/")}`);
}

/**
 * Delete the files a video no longer uses; resolves how many went. Never
 * throws: a leftover file only costs storage.
 */
async function pruneVideoFiles(artifact: VideoArtifact): Promise<number> {
  try {
    const root = `${prefix(artifact.meta.owner, artifact.meta.repo)}/`;
    const stale = staleVideoKeys(await listVideoKeys(root), artifact);
    for (let index = 0; index < stale.length; index += 20)
      await Promise.all(
        stale
          .slice(index, index + 20)
          .map((key) =>
            videoStoreBackend() === "r2"
              ? deleteObject(bucket(), key)
              : rm(localPath(key), { force: true }),
          ),
      );
    // Locally, folders emptied by the prune go too (rmdir leaves any in use).
    if (videoStoreBackend() === "local")
      for (const folder of new Set(stale.map((key) => dirname(key))))
        await rmdir(localPath(folder)).catch(() => undefined);
    if (stale.length > 0)
      console.info(
        JSON.stringify({
          event: "video.pruned",
          repository: artifact.repository,
          files: stale.length,
        }),
      );
    return stale.length;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "video.prune_failed",
        repository: artifact.repository,
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      }),
    );
    return 0;
  }
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
