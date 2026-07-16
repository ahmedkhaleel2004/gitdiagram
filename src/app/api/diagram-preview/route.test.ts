// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type * as NextServer from "next/server";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  getPreview: vi.fn(),
  writePreview: vi.fn(),
  afterCallback: undefined as undefined | (() => Promise<void>),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof NextServer>("next/server");
  return {
    ...actual,
    after: mocks.after,
  };
});

vi.mock("~/server/storage/artifact-store", () => ({
  getPublicDiagramPreview: mocks.getPreview,
  writePublicDiagramPreview: mocks.writePreview,
}));

import { GET } from "~/app/api/diagram-preview/route";

describe("GET /api/diagram-preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.afterCallback = undefined;
    mocks.after.mockImplementation((callback: () => Promise<void>) => {
      mocks.afterCallback = callback;
    });
    mocks.writePreview.mockResolvedValue(true);
  });

  it("backfills a missing sidecar after serving a canonical artifact", async () => {
    mocks.getPreview.mockResolvedValue({
      diagram: "flowchart TD",
      lastSuccessfulAt: "2026-07-16T07:00:00.000Z",
      source: "artifact",
    });
    const request = new NextRequest(
      "https://gitdiagram.com/api/diagram-preview?username=acme&repo=demo&lastSuccessfulAt=2026-07-16T07%3A00%3A00.000Z",
    );

    const response = await GET(request);
    await expect(response.json()).resolves.toMatchObject({
      diagram: "flowchart TD",
    });
    expect(mocks.after).toHaveBeenCalledOnce();

    await mocks.afterCallback?.();
    expect(mocks.writePreview).toHaveBeenCalledWith({
      username: "acme",
      repo: "demo",
      diagram: "flowchart TD",
      lastSuccessfulAt: "2026-07-16T07:00:00.000Z",
    });
  });

  it("does not rewrite a matching sidecar", async () => {
    mocks.getPreview.mockResolvedValue({
      diagram: "flowchart TD",
      lastSuccessfulAt: "2026-07-16T07:00:00.000Z",
      source: "sidecar",
    });
    const request = new NextRequest(
      "https://gitdiagram.com/api/diagram-preview?username=acme&repo=demo&lastSuccessfulAt=2026-07-16T07%3A00%3A00.000Z",
    );

    await GET(request);

    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.writePreview).not.toHaveBeenCalled();
  });
});
