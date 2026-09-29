import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/.well-known/openai-apps-challenge", () => {
  it("serves exactly the configured token as plain text", async () => {
    vi.stubEnv("OPENAI_APPS_CHALLENGE", " token_abc123-XYZ \n");
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(await response.text()).toBe("token_abc123-XYZ");
  });

  it("is not found without a well-formed token", () => {
    vi.stubEnv("OPENAI_APPS_CHALLENGE", "");
    expect(GET().status).toBe(404);
    vi.stubEnv("OPENAI_APPS_CHALLENGE", "<script>alert(1)</script>");
    expect(GET().status).toBe(404);
  });
});
