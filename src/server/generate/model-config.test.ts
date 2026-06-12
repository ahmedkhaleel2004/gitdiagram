import { afterEach, describe, expect, it } from "vitest";

import {
  getModel,
  getProvider,
  getProviderLabel,
  shouldUseExactInputTokenCount,
} from "~/server/generate/model-config";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getProvider", () => {
  it("recognizes atlas as a first-class provider", () => {
    process.env.AI_PROVIDER = "atlas";

    expect(getProvider()).toBe("atlas");
    expect(getProviderLabel("atlas")).toBe("Atlas Cloud");
  });
});

describe("getModel", () => {
  it("uses the Atlas model override when configured", () => {
    process.env.ATLAS_MODEL = "deepseek-ai/DeepSeek-V3-0324";

    expect(getModel("atlas")).toBe("deepseek-ai/DeepSeek-V3-0324");
  });

  it("falls back to the documented Atlas model id", () => {
    delete process.env.ATLAS_MODEL;

    expect(getModel("atlas")).toBe("deepseek-ai/DeepSeek-V3-0324");
  });
});

describe("shouldUseExactInputTokenCount", () => {
  it("keeps Atlas on the conservative local token fallback", () => {
    expect(
      shouldUseExactInputTokenCount({
        provider: "atlas",
        apiKey: "apikey-test",
      }),
    ).toBe(false);
  });
});
