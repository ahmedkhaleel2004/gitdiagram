import { describe, expect, it } from "vitest";

import { buildQuotaKey } from "~/server/storage/quota-store";

describe("buildQuotaKey", () => {
  it("normalizes snapshot model families into the shared daily key", () => {
    expect(
      buildQuotaKey(
        "2026-03-30",
        "openai:gpt-5.4-mini-2026-03-17:complimentary",
      ),
    ).toBe("quota:v1:2026-03-30:gpt-5.4-mini");
  });
});
