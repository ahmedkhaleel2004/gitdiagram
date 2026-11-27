import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ readVideoArtifact: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
}));
vi.mock("~/server/explainer/store", () => ({
  readVideoArtifact: store.readVideoArtifact,
  publicVideoArtifact: (video: { stats: object }) => ({
    ...video,
    stats: { ...video.stats, plannerCostUsd: null },
  }),
}));
vi.mock("~/server/explainer/config", () => ({
  isVideoExplainerEnabled: () => true,
}));
vi.mock("../../video-watch-page-client", () => ({ default: () => null }));

import FocusedVideoPage, { generateMetadata } from "./page";

const KEY = "0123456789abcdef";
const params = (key = KEY) =>
  Promise.resolve({ username: "acme", repo: "demo", key });

const artifact = {
  createdAt: "2026-09-24T00:00:00.000Z",
  meta: { owner: "acme", repo: "demo" },
  stats: { plannerCostUsd: 1.5 },
  focus: { text: "the retry loop", key: KEY },
};

beforeEach(() => {
  vi.clearAllMocks();
  store.readVideoArtifact.mockResolvedValue(artifact);
});

describe("a focused film's watch page", () => {
  it("is never indexed", async () => {
    const metadata = await generateMetadata({ params: params() });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("plays the film stored under its key, without what it cost", async () => {
    const page = (await FocusedVideoPage({
      params: params(),
    })) as ReactElement<{
      username: string;
      repo: string;
      video: typeof artifact;
    }>;
    expect(store.readVideoArtifact).toHaveBeenCalledWith("acme", "demo", KEY);
    expect(page.props).toMatchObject({ username: "acme", repo: "demo" });
    expect(page.props.video.focus).toEqual(artifact.focus);
    expect(page.props.video.stats.plannerCostUsd).toBeNull();
  });

  it("is not found for a malformed key, before any read", async () => {
    for (const key of ["0123456789ABCDEF", "0123", "../../x", `${KEY}0`])
      await expect(FocusedVideoPage({ params: params(key) })).rejects.toThrow(
        "not found",
      );
    expect(store.readVideoArtifact).not.toHaveBeenCalled();
  });

  it("is not found when no film is stored under the key", async () => {
    store.readVideoArtifact.mockResolvedValue(null);
    await expect(FocusedVideoPage({ params: params() })).rejects.toThrow(
      "not found",
    );
  });
});
