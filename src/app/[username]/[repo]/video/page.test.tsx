import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  readVideoArtifact: vi.fn(),
  renderStamp: vi.fn(),
  hasRender: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: (read: () => Promise<unknown>) => read,
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
  permanentRedirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("~/server/explainer/store", () => store);
vi.mock("~/server/explainer/cache", () => ({
  videoSummaryTag: (username: string, repo: string) => `${username}/${repo}`,
}));
vi.mock("~/server/explainer/config", () => ({
  isVideoExplainerEnabled: () => true,
}));
vi.mock("./video-watch-page-client", () => ({ default: () => null }));

import VideoWatchPage, { generateMetadata } from "./page";

const params = Promise.resolve({ username: "acme", repo: "demo" });

const artifact = {
  createdAt: "2026-09-24T00:00:00.000Z",
  meta: { owner: "acme", repo: "demo" },
  timing: { DURATION: 61.6 },
  plan: {
    beats: [
      { narration: "Demo draws diagrams." },
      { narration: "It reads the code first." },
      { narration: "Later." },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  store.readVideoArtifact.mockResolvedValue(null);
  store.renderStamp.mockResolvedValue(1234);
  store.hasRender.mockResolvedValue(true);
});

describe("video watch page without a video", () => {
  it("keeps the page out of search and does not promise a video", async () => {
    const metadata = await generateMetadata({ params });
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.title).toBe("acme/demo video tour | GitDiagram");
    expect(metadata.openGraph).toMatchObject({ type: "website" });
    expect(metadata.openGraph).not.toHaveProperty("videos");
  });

  it("renders no structured data", async () => {
    const page = (await VideoWatchPage({ params })) as ReactElement<{
      children: ReactElement[];
    }>;
    const [ld] = page.props.children;
    expect(ld).toBeFalsy();
  });
});

describe("video watch page with a video", () => {
  beforeEach(() => store.readVideoArtifact.mockResolvedValue(artifact));

  it("previews the stored poster and MP4", async () => {
    const metadata = await generateMetadata({ params });
    expect(metadata.robots).toBeUndefined();
    expect(metadata.title).toBe(
      "acme/demo, explained in a minute | GitDiagram",
    );
    expect(metadata.description).toBe(
      "Demo draws diagrams. It reads the code first.",
    );
    expect(metadata.openGraph).toMatchObject({
      type: "video.other",
      images: [
        {
          url: "https://gitdiagram.com/api/video/file?username=acme&repo=demo&format=poster&v=2026-09-24T00%3A00%3A00.000Z&p=1234",
        },
      ],
      videos: [
        {
          url: "https://gitdiagram.com/api/video/file?username=acme&repo=demo&format=landscape&v=2026-09-24T00%3A00%3A00.000Z",
        },
      ],
    });
  });

  it("describes the video as a schema.org VideoObject", async () => {
    const page = (await VideoWatchPage({ params })) as ReactElement<{
      children: ReactElement<{
        dangerouslySetInnerHTML: { __html: string };
      }>[];
    }>;
    const [ld] = page.props.children;
    const data = JSON.parse(ld!.props.dangerouslySetInnerHTML.__html) as Record<
      string,
      unknown
    >;
    expect(data).toMatchObject({
      "@type": "VideoObject",
      uploadDate: "2026-09-24T00:00:00.000Z",
      duration: "PT62S",
      url: "https://gitdiagram.com/acme/demo/video",
      contentUrl: expect.stringContaining("format=landscape"),
      thumbnailUrl: [expect.stringContaining("format=poster")],
    });
  });

  it("escapes markup in narration inside the structured data", async () => {
    store.readVideoArtifact.mockResolvedValue({
      ...artifact,
      plan: { beats: [{ narration: "</script><script>alert(1)</script>" }] },
    });
    const page = (await VideoWatchPage({ params })) as ReactElement<{
      children: ReactElement<{
        dangerouslySetInnerHTML: { __html: string };
      }>[];
    }>;
    const html = page.props.children[0]!.props.dangerouslySetInnerHTML.__html;
    expect(html).not.toContain("<");
  });
});
