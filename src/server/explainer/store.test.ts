import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("~/features/explainer/engine", () => ({ ENGINE_VERSION: "15" }));

import type { VideoArtifact } from "~/features/explainer/types";
import { staleVideoKeys, videoVersion } from "./store";

const artifact = {
  createdAt: "2026-09-24T08:06:45.297Z",
  meta: { owner: "Acme", repo: "Widget" },
} as VideoArtifact;
const root = "video/v1/acme/widget";
const current = `${root}/1790237205297`;

describe("explainer video storage", () => {
  it("names a video's file folder after its creation time", () => {
    expect(videoVersion("2026-09-24T08:06:45.297Z")).toBe("1790237205297");
    expect(videoVersion("not a date")).toBeNull();
  });

  it("names the files the current version no longer uses", () => {
    const keys = [
      `${root}/artifact.json`,
      `${current}/beat-00.mp3`,
      `${current}/poster.jpg`,
      `${current}/still.jpg`,
      `${current}/landscape.e15.mp4`,
      `${current}/landscape.e14.mp4`,
      `${current}/vertical.e9.mp4`,
      `${current}/poster.e13.jpg`,
      `${root}/1790000000000/beat-00.mp3`,
      `${root}/1790000000000/beat-01.mp3`,
      `${root}/1790000000000/landscape.e15.mp4`,
    ];
    expect(staleVideoKeys(keys, artifact)).toEqual([
      `${current}/landscape.e14.mp4`,
      `${current}/vertical.e9.mp4`,
      `${current}/poster.e13.jpg`,
      `${root}/1790000000000/beat-00.mp3`,
      `${root}/1790000000000/beat-01.mp3`,
      `${root}/1790000000000/landscape.e15.mp4`,
    ]);
  });

  it("never names newer files, or another repository's", () => {
    const keys = [
      `${root}/1799999999999/beat-00.mp3`,
      `${current}/landscape.e16.mp4`,
      `${current}/poster.e16.jpg`,
      "video/v1/acme/widget-two/1790000000000/beat-00.mp3",
      "video/v1/acme/widgetx/artifact.json",
    ];
    expect(staleVideoKeys(keys, artifact)).toEqual([]);
  });
});
