import { spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import ffmpegStatic from "ffmpeg-static";
import { startEncoder } from "./render";

const ffmpeg = ffmpegStatic as unknown as string;

const alive = (pid: number | undefined) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// The same encoder settings a segment uses, reading JPEG frames from stdin.
const segmentArgs = (out: string) => [
  "-y",
  "-loglevel",
  "error",
  "-f",
  "image2pipe",
  "-framerate",
  "30",
  "-c:v",
  "mjpeg",
  "-i",
  "pipe:0",
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-pix_fmt",
  "yuv420p",
  out,
];

describe("the segment encoder", () => {
  let dir = "";
  let jpeg: Buffer;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "encoder-test-"));
    jpeg = spawnSync(ffmpeg, [
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=64x64",
      "-frames:v",
      "1",
      "-f",
      "mjpeg",
      "pipe:1",
    ]).stdout;
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("encodes the frames it is fed", async () => {
    const out = join(dir, "ok.mp4");
    const encoder = startEncoder(ffmpeg, segmentArgs(out));
    for (let index = 0; index < 6; index++) await encoder.write(jpeg);
    await encoder.finish();
    expect((await stat(out)).size).toBeGreaterThan(0);
  });

  it("kills an ffmpeg still waiting on stdin when the render fails", async () => {
    const encoder = startEncoder(ffmpeg, segmentArgs(join(dir, "cut.mp4")));
    await encoder.write(jpeg);
    const pid = encoder.pid;
    await encoder.kill();
    expect(alive(pid)).toBe(false);
    await expect(encoder.write(jpeg)).rejects.toThrow();
  });

  it("rejects a write waiting on a full pipe once the encoder dies", async () => {
    // Stands in for an ffmpeg that stalls: it never reads stdin.
    const encoder = startEncoder(process.execPath, [
      "-e",
      "setTimeout(() => {}, 60_000)",
    ]);
    const pid = encoder.pid;
    const write = encoder.write(Buffer.alloc(8 * 2 ** 20));
    setTimeout(() => process.kill(pid!, "SIGKILL"), 100);
    // EPIPE on the pipe, or the exit itself, whichever lands first.
    await expect(write).rejects.toThrow();
    await encoder.kill();
  });

  it("fails fast, never hangs, when ffmpeg cannot start", async () => {
    const encoder = startEncoder(join(dir, "no-such-ffmpeg"), []);
    await expect(encoder.write(Buffer.alloc(8 * 2 ** 20))).rejects.toThrow();
    await expect(encoder.finish()).rejects.toThrow();
    await encoder.kill();
  });
});
