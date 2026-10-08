// One full-size frame: bun experiments/video-hillclimb/shot.ts <film dir> <beat> [out.jpg]
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoArtifact } from "~/features/explainer/types";
import { HOLD, closeBrowser, held, openStage, seek } from "./stage";
const [dir, beat, out] = process.argv.slice(2);
const artifact = held(
  JSON.parse(
    await readFile(join(dir!, "artifact.json"), "utf8"),
  ) as VideoArtifact,
);
const page = await openStage(artifact, 0.6);
for (const b of beat!.split(",")) {
  await seek(
    page,
    artifact.timing.beats[Number(b)]!.end +
      (process.env.MID ? -0.3 : HOLD * 0.8),
  );
  await page.screenshot({
    path: (out ?? `/tmp/shot-${b}.jpg`) as `${string}.jpg`,
    type: "jpeg",
    quality: 85,
  });
}
await closeBrowser();
