// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStoredDiagramState: vi.fn(),
  markdown: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: (read: () => Promise<unknown>) => () => read(),
}));
vi.mock("~/server/storage/artifact-store", () => ({
  getStoredDiagramState: mocks.getStoredDiagramState,
}));
vi.mock("~/server/explainer/config", () => ({
  isVideoExplainerEnabled: () => false,
}));
vi.mock("~/server/explainer/video-index", () => ({
  hasIndexedVideo: vi.fn(),
}));
vi.mock("~/server/explainer/cache", () => ({
  videoSummaryTag: () => "tag",
}));
vi.mock("~/lib/sponsor-campaign", async (original) => {
  const actual = await original<typeof SponsorCampaigns>();
  return {
    ...actual,
    // No booking has the Markdown placement yet: give one campaign it here.
    findSponsorCampaign: (id: string) => {
      const campaign = actual.findSponsorCampaign(id);
      return campaign && { ...campaign, markdown: mocks.markdown };
    },
  };
});

import type * as SponsorCampaigns from "~/lib/sponsor-campaign";
import { sentCampaign } from "~/lib/sponsor-campaign";
import { sponsorCreatives } from "~/lib/sponsor-creative";
import { GET, revalidate } from "./route";
import { REPOSITORY_MARKDOWN_REVALIDATE } from "~/server/repository-markdown";

const call = (sponsor: string, username = "acme", repo = "demo") =>
  GET(new Request(`https://gitdiagram.com/${username}/${repo}.md`), {
    params: Promise.resolve({ username, repo, sponsor }),
  });

beforeEach(() => {
  mocks.markdown = true;
  mocks.getStoredDiagramState.mockResolvedValue({
    diagram: 'flowchart TD\n  node_app["App"]',
    explanation: "Demo serves notes.",
    graph: { groups: [], nodes: [], edges: [] },
    latestSessionAudit: null,
    lastSuccessfulAt: "2026-09-19T00:00:00Z",
  });
});

describe("repository Markdown with a sponsor", () => {
  it("carries that campaign's labelled line, linked through /out", async () => {
    const response = await call(sentCampaign.id);
    expect(response.status).toBe(200);
    const { name, message, action } = sponsorCreatives[sentCampaign.id];
    const link = `https://gitdiagram.com/out/${sentCampaign.id}?placement=markdown`;
    expect(await response.text()).toContain(
      `Sponsored by [${name}](${link}): ${message} [${action}](${link})`,
    );
    expect(response.headers.get("link")).toBe(
      '<https://gitdiagram.com/acme/demo>; rel="canonical"',
    );
  });

  it("answers 404 for a campaign without the placement or an unknown one", async () => {
    mocks.markdown = false;
    expect((await call(sentCampaign.id)).status).toBe(404);
    expect((await call("nobody-2020-01")).status).toBe(404);
    expect(mocks.getStoredDiagramState).not.toHaveBeenCalled();
  });

  it("is cached as long as the plain copy", () => {
    expect(revalidate).toBe(REPOSITORY_MARKDOWN_REVALIDATE);
  });
});
