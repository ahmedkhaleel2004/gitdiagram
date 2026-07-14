// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upstashEval: vi.fn(),
}));

vi.mock("~/server/storage/upstash", () => ({
  upstashEval: mocks.upstashEval,
}));

import { POST } from "~/app/api/generate/cancel/route";

const sessionId = "550e8400-e29b-41d4-a716-446655440000";
const cancelToken = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

function request(
  body: unknown,
  headers: HeadersInit = {},
  url = "https://gitdiagram.com/api/generate/cancel",
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

describe("POST /api/generate/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upstashEval.mockResolvedValue(1);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("records a validated same-origin cancellation", async () => {
    const response = await POST(
      request({ session_id: sessionId, cancel_token: cancelToken }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.upstashEval).toHaveBeenCalledWith(
      expect.objectContaining({
        keys: [
          `generation:active:${sessionId}`,
          `generation:cancel:${sessionId}`,
        ],
        args: [cancelToken, 600],
      }),
    );
  });

  it("accepts the public origin behind a trusted reverse proxy", async () => {
    const response = await POST(
      request(
        { session_id: sessionId, cancel_token: cancelToken },
        {
          Origin: "https://self-hosted.example.test",
          "X-Forwarded-Host": "self-hosted.example.test",
          "X-Forwarded-Proto": "https",
        },
        "http://0.0.0.0:8080/api/generate/cancel",
      ),
    );

    expect(response.status).toBe(204);
    expect(mocks.upstashEval).toHaveBeenCalledOnce();
  });

  it("rejects cross-origin, malformed, and non-strict payloads", async () => {
    await expect(
      POST(
        request(
          { session_id: sessionId, cancel_token: cancelToken },
          {
            Origin: "https://attacker.example",
            "Sec-Fetch-Site": "cross-site",
          },
        ),
      ),
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      POST(request({ session_id: "not-a-uuid", cancel_token: cancelToken })),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      POST(
        request({
          session_id: sessionId,
          cancel_token: cancelToken,
          extra: true,
        }),
      ),
    ).resolves.toMatchObject({ status: 400 });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("returns a retryable error when the cancellation store is unavailable", async () => {
    mocks.upstashEval.mockRejectedValue(new Error("secret-token"));

    const response = await POST(
      request({ session_id: sessionId, cancel_token: cancelToken }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Cancellation is temporarily unavailable.",
    });
  });
});
