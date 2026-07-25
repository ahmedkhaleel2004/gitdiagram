// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeInfrastructureRateLimit: vi.fn(),
  consumeRateLimit: vi.fn(),
  getClientIp: vi.fn(),
  refundInfrastructureRateLimit: vi.fn(),
  refundRateLimit: vi.fn(),
  registerActiveGeneration: vi.fn(),
  resolveRequestCredentials: vi.fn(),
}));

vi.mock("./cancellation", () => ({
  registerActiveGeneration: mocks.registerActiveGeneration,
}));
vi.mock("./rate-limit", () => ({
  consumeGenerationInfrastructureRateLimit:
    mocks.consumeInfrastructureRateLimit,
  consumeGenerationRateLimit: mocks.consumeRateLimit,
  getGenerationInfrastructureRateLimitMessage: vi.fn(
    (seconds: number) => `Retry infrastructure in ${seconds} seconds.`,
  ),
  getGenerationRateLimitMessage: vi.fn(
    (seconds: number) => `Retry in ${seconds} seconds.`,
  ),
  refundGenerationInfrastructureRateLimit: mocks.refundInfrastructureRateLimit,
  refundGenerationRateLimit: mocks.refundRateLimit,
}));
vi.mock("~/server/http/client-ip", () => ({
  getClientIp: mocks.getClientIp,
}));
vi.mock("~/server/http/request-credentials", () => ({
  resolveRequestCredentials: mocks.resolveRequestCredentials,
}));

import { admitGenerationRequest } from "./request-admission";

function request(body: Record<string, unknown> = {}) {
  return new Request("https://gitdiagram.com/api/generate/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "openai", repo: "openai-node", ...body }),
  });
}

describe("admitGenerationRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.consumeInfrastructureRateLimit.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
      consumed: true,
    });
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
      consumed: true,
    });
    mocks.getClientIp.mockReturnValue("203.0.113.10");
    mocks.refundRateLimit.mockResolvedValue(undefined);
    mocks.registerActiveGeneration.mockResolvedValue(true);
    mocks.resolveRequestCredentials.mockImplementation(
      async (
        _request: Request,
        explicit: { apiKey?: string; githubPat?: string },
      ) => explicit,
    );
  });

  it("admits a complimentary caller with normalized request context", async () => {
    const result = await admitGenerationRequest(request());

    expect(result).toMatchObject({
      admitted: true,
      value: {
        username: "openai",
        repo: "openai-node",
        cancellationRegistered: false,
      },
    });
    if (result.admitted) {
      expect(result.value.sessionId).toEqual(expect.any(String));
    }
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith({
      clientIp: "203.0.113.10",
    });
    expect(mocks.consumeInfrastructureRateLimit).toHaveBeenCalledWith({
      clientIp: "203.0.113.10",
    });
  });

  it("still infrastructure-limits a caller using their own model key", async () => {
    mocks.resolveRequestCredentials.mockResolvedValue({ apiKey: "sk-user" });

    const result = await admitGenerationRequest(request());

    expect(result.admitted).toBe(true);
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.consumeInfrastructureRateLimit).toHaveBeenCalledWith({
      clientIp: "203.0.113.10",
    });
  });

  it("returns the limiter response before registering a session", async () => {
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 900,
      consumed: true,
    });

    const result = await admitGenerationRequest(request());

    expect(result.admitted).toBe(false);
    if (!result.admitted) {
      expect(result.response.status).toBe(429);
      expect(result.response.headers.get("retry-after")).toBe("900");
      await expect(result.response.json()).resolves.toMatchObject({
        error_code: "RATE_LIMITED",
      });
    }
    expect(mocks.registerActiveGeneration).not.toHaveBeenCalled();
  });

  it("refunds the limiter when cancellation registration is unavailable", async () => {
    mocks.registerActiveGeneration.mockRejectedValue(new Error("Redis down"));

    const result = await admitGenerationRequest(
      request({
        session_id: "550e8400-e29b-41d4-a716-446655440000",
        cancel_token: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      }),
    );

    expect(result.admitted).toBe(false);
    if (!result.admitted) {
      expect(result.response.status).toBe(503);
    }
    expect(mocks.refundRateLimit).toHaveBeenCalledWith({
      clientIp: "203.0.113.10",
    });
    expect(mocks.refundInfrastructureRateLimit).toHaveBeenCalledWith({
      clientIp: "203.0.113.10",
    });
  });

  it("refunds the limiter when the requested session already exists", async () => {
    mocks.registerActiveGeneration.mockResolvedValue(false);

    const result = await admitGenerationRequest(
      request({
        session_id: "550e8400-e29b-41d4-a716-446655440000",
        cancel_token: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      }),
    );

    expect(result.admitted).toBe(false);
    if (!result.admitted) {
      expect(result.response.status).toBe(409);
      await expect(result.response.json()).resolves.toMatchObject({
        error_code: "SESSION_CONFLICT",
      });
    }
    expect(mocks.refundRateLimit).toHaveBeenCalledWith({
      clientIp: "203.0.113.10",
    });
    expect(mocks.refundInfrastructureRateLimit).toHaveBeenCalledWith({
      clientIp: "203.0.113.10",
    });
  });

  it("rejects infrastructure abuse even when a model key is present", async () => {
    mocks.resolveRequestCredentials.mockResolvedValue({
      apiKey: "not-validated",
    });
    mocks.consumeInfrastructureRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 600,
      consumed: true,
    });

    const result = await admitGenerationRequest(request());

    expect(result.admitted).toBe(false);
    if (!result.admitted) {
      expect(result.response.status).toBe(429);
    }
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.registerActiveGeneration).not.toHaveBeenCalled();
  });

  it("rejects invalid transport input before resolving credentials", async () => {
    const invalidRequest = new Request(
      "https://gitdiagram.com/api/generate/stream",
      {
        method: "POST",
        body: "{}",
      },
    );

    const result = await admitGenerationRequest(invalidRequest);

    expect(result.admitted).toBe(false);
    if (!result.admitted) {
      expect(result.response.status).toBe(415);
    }
    expect(mocks.resolveRequestCredentials).not.toHaveBeenCalled();
  });
});
mocks.refundInfrastructureRateLimit.mockResolvedValue(undefined);
