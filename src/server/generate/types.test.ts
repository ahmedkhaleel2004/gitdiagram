import { describe, expect, it } from "vitest";

import {
  MAX_GENERATION_REQUEST_BYTES,
  parseGenerateRequest,
} from "~/server/generate/types";

function jsonRequest(body: unknown, headers?: HeadersInit) {
  return new Request("https://gitdiagram.com/api/generate/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("parseGenerateRequest", () => {
  it("trims and accepts a bounded GitHub generation request", async () => {
    const result = await parseGenerateRequest(
      jsonRequest({
        username: "  openai  ",
        repo: "  openai-node  ",
        api_key: "  sk-test  ",
      }),
    );

    expect(result).toEqual({
      success: true,
      data: {
        username: "openai",
        repo: "openai-node",
        api_key: "sk-test",
      },
    });
  });

  it("accepts only paired RFC-compliant session and cancellation IDs", async () => {
    const sessionId = "550e8400-e29b-41d4-a716-446655440000";
    const cancelToken = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    await expect(
      parseGenerateRequest(
        jsonRequest({
          username: "openai",
          repo: "openai-node",
          session_id: sessionId,
          cancel_token: cancelToken,
        }),
      ),
    ).resolves.toMatchObject({
      success: true,
      data: { session_id: sessionId, cancel_token: cancelToken },
    });

    await expect(
      parseGenerateRequest(
        jsonRequest({
          username: "openai",
          repo: "openai-node",
          session_id: "predictable-session",
          cancel_token: cancelToken,
        }),
      ),
    ).resolves.toMatchObject({ success: false, status: 400 });

    await expect(
      parseGenerateRequest(
        jsonRequest({
          username: "openai",
          repo: "openai-node",
          session_id: sessionId,
        }),
      ),
    ).resolves.toMatchObject({ success: false, status: 400 });
  });

  it("rejects malformed repository coordinates and unknown fields", async () => {
    await expect(
      parseGenerateRequest(
        jsonRequest({ username: "../owner", repo: "repo/name" }),
      ),
    ).resolves.toMatchObject({
      success: false,
      status: 400,
      errorCode: "VALIDATION_ERROR",
    });

    await expect(
      parseGenerateRequest(
        jsonRequest({ username: "openai", repo: "openai-node", extra: true }),
      ),
    ).resolves.toMatchObject({
      success: false,
      status: 400,
      errorCode: "VALIDATION_ERROR",
    });
  });

  it("requires JSON and rejects malformed JSON", async () => {
    await expect(
      parseGenerateRequest(
        new Request("https://gitdiagram.com/api/generate/stream", {
          method: "POST",
          body: "not-json",
        }),
      ),
    ).resolves.toMatchObject({ success: false, status: 415 });

    await expect(
      parseGenerateRequest(
        new Request("https://gitdiagram.com/api/generate/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{",
        }),
      ),
    ).resolves.toMatchObject({ success: false, status: 400 });
  });

  it("rejects payloads above the endpoint bound", async () => {
    const request = new Request("https://gitdiagram.com/api/generate/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "openai",
        repo: "openai-node",
        api_key: "x".repeat(MAX_GENERATION_REQUEST_BYTES),
      }),
    });

    await expect(parseGenerateRequest(request)).resolves.toMatchObject({
      success: false,
      status: 413,
      errorCode: "PAYLOAD_TOO_LARGE",
    });
  });
});

describe("parseGenerateRequest commit", () => {
  const full = "0123456789abcdef0123456789abcdef01234567";

  it("leaves the request without a commit exactly as before", async () => {
    const result = await parseGenerateRequest(
      jsonRequest({ username: "acme", repo: "demo" }),
    );

    expect(result).toEqual({
      success: true,
      data: { username: "acme", repo: "demo" },
    });
    expect(result.success && "commit" in result.data).toBe(false);
  });

  it("accepts a full or short SHA and normalizes it", async () => {
    await expect(
      parseGenerateRequest(
        jsonRequest({
          username: "acme",
          repo: "demo",
          commit: ` ${full.toUpperCase()} `,
        }),
      ),
    ).resolves.toEqual({
      success: true,
      data: { username: "acme", repo: "demo", commit: full },
    });
    await expect(
      parseGenerateRequest(
        jsonRequest({ username: "acme", repo: "demo", commit: "ABC1234" }),
      ),
    ).resolves.toEqual({
      success: true,
      data: { username: "acme", repo: "demo", commit: "abc1234" },
    });
  });

  it.each(["", "main", "abc123", "HEAD~1", `${full}0`, "a".repeat(300)])(
    "rejects the malformed commit %j with its own error code",
    async (commit) => {
      await expect(
        parseGenerateRequest(
          jsonRequest({ username: "acme", repo: "demo", commit }),
        ),
      ).resolves.toMatchObject({
        success: false,
        status: 400,
        errorCode: expect.stringMatching(
          /^(COMMIT_SHA_INVALID|VALIDATION_ERROR)$/u,
        ),
      });
    },
  );

  it("names a malformed SHA as one", async () => {
    await expect(
      parseGenerateRequest(
        jsonRequest({ username: "acme", repo: "demo", commit: "main" }),
      ),
    ).resolves.toMatchObject({
      success: false,
      status: 400,
      errorCode: "COMMIT_SHA_INVALID",
    });
  });

  it("does not accept a non-string commit", async () => {
    await expect(
      parseGenerateRequest(
        jsonRequest({ username: "acme", repo: "demo", commit: 1234567 }),
      ),
    ).resolves.toMatchObject({ success: false, status: 400 });
  });
});
