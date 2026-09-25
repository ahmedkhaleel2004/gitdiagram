// Re-narrates a stored experiment film with the production narrator and
// renders it, to check the voice against the captions and scene cues.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoArtifact } from "~/features/explainer/types";
import { narrateBeats } from "~/server/explainer/narration";
import {
  assembleMp4,
  mixSoundtrack,
  segmentRanges,
} from "~/server/explainer/ffmpeg";
import { renderVideoSegment } from "~/server/explainer/render";
import { videoVersion } from "~/server/explainer/store";

const [owner, repo] = (process.argv[2] ?? "fastapi/fastapi").split("/") as [
  string,
  string,
];
const source = `experiments/video-models/out/runs/opus-low/.video-cache/video/v1/${owner}/${repo}`;
const artifact = JSON.parse(
  await readFile(join(source, "artifact.json"), "utf8"),
) as VideoArtifact;
const report = JSON.parse(
  await readFile(join(source, "report.json"), "utf8"),
) as {
  script: {
    beats: Array<{ scene: string; narration: string }>;
  };
};
const started = Date.now();
const narration = await narrateBeats(report.script.beats);
console.info(
  `narrated by ${narration.voice} in ${Math.round((Date.now() - started) / 1000)}s, ${narration.timing.DURATION}s film`,
);
const words = narration.timing.beats.reduce(
  (sum, beat) => sum + beat.words.length,
  0,
);
console.info(
  `${words} timed words; beat starts:`,
  narration.timing.beats.map((b) => b.start.toFixed(1)).join(" "),
);

const film: VideoArtifact = {
  ...artifact,
  createdAt: new Date().toISOString(),
  timing: narration.timing,
  voices: narration.voices,
};
// The store reads narration from ./.video-cache.
const dir = join(process.cwd(), "experiments", "voices", "out", "film");
const store = join(
  dir,
  ".video-cache",
  "video",
  "v1",
  owner.toLowerCase(),
  repo.toLowerCase(),
  videoVersion(film.createdAt)!,
);
await mkdir(store, { recursive: true });
await writeFile(join(store, "beat-00.mp3"), narration.clips[0]!);
process.chdir(dir);
const origin = "http://127.0.0.1:4599";
let sfx: Parameters<typeof mixSoundtrack>[0]["sfx"] = [];
const segments: Buffer[] = [];
for (const range of segmentRanges(film)) {
  const first = !segments.length;
  segments.push(
    await renderVideoSegment({
      artifact: film,
      format: "landscape",
      origin,
      ...range,
      onReady: (cues) => {
        if (first) sfx = cues;
      },
    }),
  );
}
const soundtrack = await mixSoundtrack({ artifact: film, sfx, origin });
await writeFile(
  join(dir, `${repo}-gemini.mp4`),
  await assembleMp4({ segments, soundtrack }),
);
console.info("rendered", join(dir, `${repo}-gemini.mp4`));
