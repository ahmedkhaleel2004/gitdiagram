import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  instanceName,
  isContainerPath,
  isSignedSegmentJob,
  parseSegmentJob,
  renderInstance,
  segmentInstances,
  segmentSignature,
  type SegmentJob,
} from "./router";

const SECRET = "test-secret";

/** `sign` from src/server/explainer/segments.ts, as the site computes it. */
function siteSignature(job: SegmentJob): string {
  const key = createHmac("sha256", SECRET)
    .update("video-segment-key/v1")
    .digest();
  const payload = JSON.stringify([
    job.username.toLowerCase(),
    job.repo.toLowerCase(),
    job.v,
    job.format,
    job.from,
    job.to,
    job.exp,
    ...(job.edit ? [job.edit] : []),
  ]);
  return createHmac("sha256", key).update(payload).digest("hex");
}

const job: SegmentJob = {
  username: "AhmedKhaleel2004",
  repo: "GitDiagram",
  v: "2026-09-26T10:30:15.666Z",
  format: "vertical",
  from: 150,
  to: 300,
  exp: 2_000_000_000_000,
  edit: [
    [0, 0.31, 1],
    [1.25, 0.9000000000000001, 2.5],
  ],
};

describe("container paths", () => {
  it("are the three routes that spawn ffmpeg or Chromium", () => {
    for (const path of [
      "/api/video/render",
      "/api/video/render/",
      "/api/video/render/segment",
      "/api/video/generate",
    ])
      expect(isContainerPath(path)).toBe(true);
    for (const path of [
      "/",
      "/api/video",
      "/api/video/file",
      "/api/video/render/segment/x",
      "/api/video/generated",
    ])
      expect(isContainerPath(path)).toBe(false);
  });
});

describe("segment jobs", () => {
  it("carry the signature the site computes", async () => {
    // The body crosses the wire as JSON, so the router signs what it parsed.
    const parsed = parseSegmentJob(JSON.stringify(job))!;
    expect(await segmentSignature(parsed, SECRET)).toBe(siteSignature(job));
    const plain: SegmentJob = { ...job, format: "landscape" };
    delete plain.edit;
    expect(await segmentSignature(plain, SECRET)).toBe(siteSignature(plain));
  });

  it("pass only signed, unexpired, well-formed", async () => {
    const signature = siteSignature(job);
    expect(await isSignedSegmentJob(job, signature, SECRET, 1)).toBe(true);
    expect(await isSignedSegmentJob(job, signature, "other", 1)).toBe(false);
    expect(await isSignedSegmentJob(job, "00", SECRET, 1)).toBe(false);
    expect(
      await isSignedSegmentJob({ ...job, to: 301 }, signature, SECRET, 1),
    ).toBe(false);
    expect(await isSignedSegmentJob(job, signature, SECRET, job.exp + 1)).toBe(
      false,
    );
    expect(parseSegmentJob("not json")).toBeNull();
    expect(parseSegmentJob('{"username":"a"}')).toBeNull();
    expect(parseSegmentJob("[]")).toBeNull();
  });
});

describe("the pool", () => {
  it("gives neighbouring segments one instance and spreads the rest", () => {
    const first = (segment: number) => segmentInstances(segment * 150, 5, 2)[0];
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(first)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 0, 0,
    ]);
  });

  it("tries every instance once, starting at the preferred one", () => {
    expect(segmentInstances(4 * 150, 5, 2)).toEqual([2, 3, 4, 0, 1]);
    expect(segmentInstances(0, 1, 2)).toEqual([0]);
    expect(segmentInstances(900, 3, 4)).toEqual([1, 2, 0]);
    expect(instanceName(3)).toBe("render-3");
  });

  it("puts overflow instances after the whole pool, in a ring of their own", () => {
    expect(segmentInstances(0, 5, 2, 5)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(segmentInstances(4 * 150, 5, 2, 3)).toEqual([
      2, 3, 4, 0, 1, 7, 5, 6,
    ]);
    expect(segmentInstances(4 * 150, 5, 2, 0)).toEqual([2, 3, 4, 0, 1]);
  });

  it("runs the same film's render on the same instance, and films apart", () => {
    const body = (repo: string, format = "landscape") =>
      JSON.stringify({ username: "Owner", repo, format });
    expect(renderInstance(body("repo"), 5)).toBe(
      renderInstance(
        JSON.stringify({
          username: "owner",
          repo: "REPO",
          format: "landscape",
        }),
        5,
      ),
    );
    const used = new Set(
      Array.from({ length: 40 }, (_, index) =>
        renderInstance(body(`repo-${index}`), 5),
      ),
    );
    expect([...used].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(renderInstance("not json", 5)).toBe(0);
    expect(renderInstance("{}", 5)).toBe(0);
    expect(renderInstance(body("repo"), 1)).toBe(0);
  });
});
