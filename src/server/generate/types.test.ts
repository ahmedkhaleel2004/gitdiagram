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
