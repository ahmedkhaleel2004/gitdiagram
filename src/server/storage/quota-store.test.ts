import { describe, expect, it } from "vitest";

import { buildQuotaKey } from "~/server/storage/quota-store";

describe("buildQuotaKey", () => {
  it("uses the shared complimentary group bucket for the daily key", () => {
    expect(
      buildQuotaKey("2026-03-30", "openai-complimentary-small-models"),
    ).toBe("quota:v2:2026-03-30:openai-complimentary-small-models");
  });
});
