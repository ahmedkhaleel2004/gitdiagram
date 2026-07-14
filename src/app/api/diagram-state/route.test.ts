// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDiagramStateRecord: vi.fn(),
}));

vi.mock("~/server/storage/diagram-state", () => ({
  getDiagramStateRecord: mocks.getDiagramStateRecord,
}));

import { POST } from "~/app/api/diagram-state/route";

function request(
  body: unknown,
  headers: HeadersInit = {},
  url = "https://gitdiagram.com/api/diagram-state",
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://gitdiagram.com",
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/diagram-state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("returns a validated public diagram state without caching it", async () => {
    const state = {
      diagram: "flowchart TD\nA-->B",
      explanation: "Example",
      graph: null,
      latestSessionAudit: null,
      lastSuccessfulAt: "2026-07-13T12:00:00.000Z",
    };
    mocks.getDiagramStateRecord.mockResolvedValue(state);

    const response = await POST(
      request({ username: " openai ", repo: " openai-node " }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(state);
    expect(mocks.getDiagramStateRecord).toHaveBeenCalledWith(
      "openai",
      "openai-node",
      undefined,
    );
  });

  it("accepts the public origin behind a trusted reverse proxy", async () => {
    mocks.getDiagramStateRecord.mockResolvedValue({
      diagram: null,
      explanation: null,
      graph: null,
      latestSessionAudit: null,
      lastSuccessfulAt: null,
    });

    const response = await POST(
      request(
        { username: "octocat", repo: "Hello-World" },
        {
          Origin: "https://self-hosted.example.test",
          "X-Forwarded-Host": "self-hosted.example.test",
          "X-Forwarded-Proto": "https",
        },
        "http://0.0.0.0:8080/api/diagram-state",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.getDiagramStateRecord).toHaveBeenCalledWith(
      "octocat",
      "Hello-World",
      undefined,
    );
  });

  it("rejects cross-origin and malformed requests before storage access", async () => {
    await expect(
      POST(
        request(
          { username: "openai", repo: "openai-node" },
          {
            Origin: "https://attacker.example",
            "Sec-Fetch-Site": "cross-site",
          },
        ),
      ),
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      POST(request({ username: "../openai", repo: "repo/name" })),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      POST(request({ username: "openai", repo: "openai-node", extra: true })),
    ).resolves.toMatchObject({ status: 400 });
    expect(mocks.getDiagramStateRecord).not.toHaveBeenCalled();
  });

  it("does not leak private credentials when storage is unavailable", async () => {
    mocks.getDiagramStateRecord.mockRejectedValue(
      new Error("Bearer private-github-token"),
    );

    const response = await POST(
      request({
        username: "openai",
        repo: "private-repo",
        github_pat: "private-github-token",
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Diagram state is temporarily unavailable.",
    });
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).not.toContain(
      "private-github-token",
    );
  });
});
