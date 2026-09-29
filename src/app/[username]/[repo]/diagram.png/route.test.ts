// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDiagramPictureData: vi.fn(),
  createDiagramPicture: vi.fn(),
  createRepoSocialImage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("~/server/og/diagram-picture-data", () => ({
  getDiagramPictureData: mocks.getDiagramPictureData,
}));
vi.mock("~/server/og/diagram-picture", () => ({
  createDiagramPicture: mocks.createDiagramPicture,
}));
vi.mock("~/server/og/cards", () => ({
  createRepoSocialImage: mocks.createRepoSocialImage,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
  permanentRedirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

import { GET } from "./route";

const call = (username: string, repo: string) =>
  GET(new Request("https://gitdiagram.com/x"), {
    params: Promise.resolve({ username, repo }),
  });

describe("GET /[username]/[repo]/diagram.png", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("draws the stored public diagram", async () => {
    const graph = { groups: [], nodes: [], edges: [] };
    const picture = new Response("png");
    mocks.getDiagramPictureData.mockResolvedValue({ kind: "graph", graph });
    mocks.createDiagramPicture.mockResolvedValue(picture);

    await expect(call("acme", "demo")).resolves.toBe(picture);
    expect(mocks.createDiagramPicture).toHaveBeenCalledWith({
      username: "acme",
      repo: "demo",
      graph,
    });
  });

  it("answers 404 without a public diagram", async () => {
    mocks.getDiagramPictureData.mockResolvedValue(null);
    await expect(call("acme", "private")).rejects.toThrow("not-found");
    expect(mocks.createDiagramPicture).not.toHaveBeenCalled();
  });

  it("redirects mixed case to the one cached lowercase URL", async () => {
    await expect(call("Acme", "Demo")).rejects.toThrow(
      "redirect:/acme/demo/diagram.png",
    );
    expect(mocks.getDiagramPictureData).not.toHaveBeenCalled();
  });

  it("shows the repository card for an old diagram without a graph", async () => {
    mocks.getDiagramPictureData.mockResolvedValue({
      kind: "card",
      stargazerCount: 3,
    });
    await call("acme", "old");
    expect(mocks.createRepoSocialImage).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "acme",
        repo: "old",
        isPrivate: false,
      }),
    );
  });
});
