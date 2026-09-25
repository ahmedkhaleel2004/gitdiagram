/**
 * Render a film to MP4 the way production does (segments, soundtrack, join).
 * Narration is read from ./.video-cache under `cwd`.
 *
 *   bun --conditions=react-server experiments/video-bespoke/render.ts <artifact.json> <cwd> <out.mp4>
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { VideoArtifact } from "~/features/explainer/types";
import {
  assembleMp4,
  mixSoundtrack,
  renderVideoSegment,
  segmentRanges,
} from "~/server/explainer/render";

const [artifactPath, cwd, out] = process.argv
  .slice(2)
  .map((p) => resolve(p)) as [string, string, string];
const origin = process.env.STAGE_ORIGIN ?? "http://127.0.0.1:4599";
const artifact = JSON.parse(
  await readFile(artifactPath, "utf8"),
) as VideoArtifact;
process.chdir(cwd);
const started = Date.now();
let sfx: Parameters<typeof mixSoundtrack>[0]["sfx"] = [];
const segments: Buffer[] = [];
// Three Chromiums at a time is plenty for a 16 GB Mac.
const ranges = segmentRanges(artifact);
for (let i = 0; i < ranges.length; i += 3) {
  const batch = await Promise.all(
    ranges
      .slice(i, i + 3)
      .map((range) =>
        renderVideoSegment({ artifact, format: "landscape", origin, ...range }),
      ),
  );
  if (i === 0) sfx = batch[0]!.sfx;
  segments.push(...batch.map((b) => b.mp4));
}
const soundtrack = await mixSoundtrack({ artifact, sfx, origin });
await writeFile(out, await assembleMp4({ segments, soundtrack }));
console.info(`${out} in ${Math.round((Date.now() - started) / 1000)}s`);
