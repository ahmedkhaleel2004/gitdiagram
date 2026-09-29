import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upstashCommand: vi.fn() }));
vi.mock("~/server/storage/upstash", () => ({
  upstashCommand: mocks.upstashCommand,
}));

import { GET } from "./route";

beforeEach(() => {
  mocks.upstashCommand.mockReset();
  mocks.upstashCommand.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/.well-known/openai-apps-challenge", () => {
  it("serves exactly the configured token as plain text", async () => {
    vi.stubEnv("OPENAI_APPS_CHALLENGE", " token_abc123-XYZ \n");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(await response.text()).toBe("token_abc123-XYZ");
    expect(mocks.upstashCommand).not.toHaveBeenCalled();
  });

  it("falls back to the token stored in Redis", async () => {
    vi.stubEnv("OPENAI_APPS_CHALLENGE", "");
    mocks.upstashCommand.mockResolvedValue("stored_token_123");
    const response = await GET();
    expect(await response.text()).toBe("stored_token_123");
    expect(mocks.upstashCommand).toHaveBeenCalledWith([
      "GET",
      "openai:v1:apps-challenge",
    ]);
  });

  it("is not found without a well-formed token", async () => {
    vi.stubEnv("OPENAI_APPS_CHALLENGE", "<script>alert(1)</script>");
    mocks.upstashCommand.mockResolvedValue("<b>x</b>");
    expect((await GET()).status).toBe(404);
    mocks.upstashCommand.mockRejectedValue(new Error("Redis down"));
    expect((await GET()).status).toBe(404);
  });
});
