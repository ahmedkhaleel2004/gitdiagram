// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  parseSameOriginJsonRequest,
  type SameOriginJsonRequestResult,
} from "~/server/http/same-origin-json";

const requestSchema = z.strictObject({
  name: z.string().trim().min(1),
});

function request(
  body: string,
  headers: HeadersInit = {},
  url = "https://gitdiagram.com/api/example",
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://gitdiagram.com",
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
    body,
  });
}

async function expectFailure<T>(
  result: SameOriginJsonRequestResult<T>,
  status: number,
  error: string,
) {
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected request parsing to fail.");
  }

  expect(result.response.status).toBe(status);
  expect(result.response.headers.get("cache-control")).toBe("no-store");
  expect(result.response.headers.get("x-content-type-options")).toBe("nosniff");
  await expect(result.response.json()).resolves.toEqual({ ok: false, error });
}

function parse(input: Request, maxBytes = 1_024) {
  return parseSameOriginJsonRequest(input, {
    schema: requestSchema,
    maxBytes,
    crossOriginError: "Cross-origin example access is not allowed.",
  });
}

describe("parseSameOriginJsonRequest", () => {
  it("accepts same-origin JSON with media type parameters", async () => {
    const result = await parse(
      request(JSON.stringify({ name: " GitDiagram " }), {
        "Content-Type": "application/json; charset=utf-8",
      }),
    );

    expect(result).toEqual({
      success: true,
      data: { name: "GitDiagram" },
    });
  });

  it("rejects cross-origin requests before reading the body", async () => {
    const input = request(JSON.stringify({ name: "GitDiagram" }), {
      Origin: "https://attacker.example",
      "Sec-Fetch-Site": "cross-site",
    });
    const readBody = vi.spyOn(input, "text");

    const result = await parse(input);

    await expectFailure(
      result,
      403,
      "Cross-origin example access is not allowed.",
    );
    expect(readBody).not.toHaveBeenCalled();
  });

  it("requires the application/json media type", async () => {
    const result = await parse(
      request(JSON.stringify({ name: "GitDiagram" }), {
        "Content-Type": "text/plain",
      }),
    );

    await expectFailure(result, 415, "Content-Type must be application/json.");
  });

  it("rejects declared and actual UTF-8 payloads over the byte limit", async () => {
    const declaredTooLarge = await parse(
      request(JSON.stringify({ name: "GitDiagram" }), {
        "Content-Length": "1025",
      }),
    );
    await expectFailure(declaredTooLarge, 413, "Request payload is too large.");

    const multibyteBody = JSON.stringify({ name: "😀" });
    const encodedLength = new TextEncoder().encode(multibyteBody).byteLength;
    const actualTooLarge = await parse(
      request(multibyteBody, { "Content-Length": "1" }),
      encodedLength - 1,
    );
    await expectFailure(actualTooLarge, 413, "Request payload is too large.");
  });

  it.each([
    ["malformed JSON", '{"name":', 400],
    ["schema-invalid JSON", JSON.stringify({ name: "", extra: true }), 400],
  ])("rejects %s", async (_label, body, status) => {
    const result = await parse(request(body));

    await expectFailure(result, status, "Invalid request payload.");
  });

  it("turns body read failures into a canonical invalid-payload response", async () => {
    const input = request(JSON.stringify({ name: "GitDiagram" }));
    vi.spyOn(input, "text").mockRejectedValue(new Error("socket closed"));

    const result = await parse(input);

    await expectFailure(result, 400, "Invalid request payload.");
  });
});
