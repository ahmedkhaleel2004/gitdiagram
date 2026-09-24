import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { VideoArtifact } from "~/features/video/types";
import { readRequiredEnv } from "~/server/storage/config";
import {
  getBinaryObject,
  getJsonObject,
  putBinaryObject,
  putJsonObject,
} from "~/server/storage/r2";

// Explainer videos live beside diagrams but under their own prefix, so they can
// never collide with or overwrite a diagram artifact.
const segment = (value: string) =>
  encodeURIComponent(value.trim().toLowerCase());
const prefix = (username: string, repo: string) =>
  `video/v1/${segment(username)}/${segment(repo)}`;
const clipName = (index: number) =>
  `beat-${String(index).padStart(2, "0")}.mp3`;

/** Local disk in development so testing never writes production storage. */
function backend(): "local" | "r2" {
  const configured = process.env.VIDEO_STORE?.trim();
  if (configured === "local" || configured === "r2") return configured;
  return process.env.NODE_ENV === "production" ? "r2" : "local";
}

const localPath = (key: string) => join(process.cwd(), ".video-cache", key);

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
  // Write then rename so a reader never sees a half-written artifact.
  await writeFile(`${path}.tmp`, body);
  await rename(`${path}.tmp`, path);
}

export async function readVideoArtifact(
  username: string,
  repo: string,
): Promise<VideoArtifact | null> {
  const key = `${prefix(username, repo)}/artifact.json`;
  if (backend() === "local") {
    const body = await readLocal(key);
    return body ? (JSON.parse(body.toString("utf8")) as VideoArtifact) : null;
  }
  return getJsonObject<VideoArtifact>(readRequiredEnv("R2_PUBLIC_BUCKET"), key);
}

export async function readVoiceClip(
  username: string,
  repo: string,
  index: number,
): Promise<Buffer | null> {
  const key = `${prefix(username, repo)}/${clipName(index)}`;
  if (backend() === "local") return readLocal(key);
  return getBinaryObject(readRequiredEnv("R2_PUBLIC_BUCKET"), key);
}

/** Clips first, artifact last: the artifact is what makes a video visible. */
export async function writeVideo(artifact: VideoArtifact, clips: Buffer[]) {
  const base = prefix(artifact.meta.owner, artifact.meta.repo);
  if (backend() === "local") {
    await Promise.all(
      clips.map((clip, index) =>
        writeLocal(`${base}/${clipName(index)}`, clip),
      ),
    );
    await writeLocal(`${base}/artifact.json`, JSON.stringify(artifact));
    return;
  }
  const bucket = readRequiredEnv("R2_PUBLIC_BUCKET");
  await Promise.all(
    clips.map((clip, index) =>
      putBinaryObject(bucket, `${base}/${clipName(index)}`, clip, "audio/mpeg"),
    ),
  );
  await putJsonObject(bucket, `${base}/artifact.json`, artifact);
}
