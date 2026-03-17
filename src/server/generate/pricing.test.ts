import { describe, expect, it } from "vitest";

import { estimateTextTokenCostUsd, resolvePricingModel } from "~/server/generate/pricing";

describe("resolvePricingModel", () => {
  it("keeps gpt-5.4-mini on its own pricing tier", () => {
    expect(resolvePricingModel("gpt-5.4-mini")).toBe("gpt-5.4-mini");
    expect(resolvePricingModel("gpt-5.4-mini-2026-03-17")).toBe("gpt-5.4-mini");
  });
});

describe("estimateTextTokenCostUsd", () => {
  it("uses gpt-5.4-mini pricing for cost estimates", () => {
    const result = estimateTextTokenCostUsd("gpt-5.4-mini", 1_000_000, 1_000_000);

    expect(result.pricingModel).toBe("gpt-5.4-mini");
    expect(result.pricing.inputPerMillionUsd).toBe(0.75);
    expect(result.pricing.outputPerMillionUsd).toBe(4.5);
    expect(result.costUsd).toBe(5.25);
  });
});
