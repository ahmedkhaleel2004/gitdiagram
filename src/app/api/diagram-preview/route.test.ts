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

  it("rejects a malformed repository identifier before reaching storage", async () => {
    const response = await GET(
      new NextRequest(
        "https://gitdiagram.com/api/diagram-preview?username=not%20a%20user&repo=demo",
      ),
    );

    expect(response.status).toBe(400);
    expect(mocks.getPreview).not.toHaveBeenCalled();
  });

  it("bounds the timestamp so an oversized value cannot reach storage", async () => {
    const response = await GET(
      new NextRequest(
        `https://gitdiagram.com/api/diagram-preview?username=acme&repo=demo&lastSuccessfulAt=${"9".repeat(500)}`,
      ),
    );

    expect(response.status).toBe(400);
    expect(mocks.getPreview).not.toHaveBeenCalled();
  });

  it("answers a storage outage with 503 rather than an unhandled failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getPreview.mockRejectedValue(new Error("R2 unavailable"));

    const response = await GET(
      new NextRequest(
        "https://gitdiagram.com/api/diagram-preview?username=acme&repo=demo",
      ),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
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
