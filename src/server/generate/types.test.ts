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
