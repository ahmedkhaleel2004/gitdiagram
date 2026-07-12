import { afterEach, describe, expect, it } from "vitest";

import {
  getModel,
  getProvider,
  getProviderLabel,
  shouldUseExactInputTokenCount,
  supportsTextVerbosity,
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
  it("uses GPT-5.6 Terra as the OpenAI default", () => {
    delete process.env.OPENAI_MODEL;

    expect(getModel("openai")).toBe("gpt-5.6-terra");
  });

  it("preserves an explicit OpenAI model override", () => {
    process.env.OPENAI_MODEL = "gpt-5.6-luna";

    expect(getModel("openai")).toBe("gpt-5.6-luna");
  });

  it("uses GPT-5.6 Terra as the OpenRouter fallback", () => {
    delete process.env.OPENROUTER_MODEL;

    expect(getModel("openrouter")).toBe("openai/gpt-5.6-terra");
  });

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

describe("supportsTextVerbosity", () => {
  it.each([
    "gpt-5.6",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.6-terra-2026-07-09",
    " GPT-5.6-LUNA-2026-07-09 ",
  ])("accepts the exact OpenAI GPT-5.6 family model %s", (model) => {
    expect(supportsTextVerbosity("openai", model)).toBe(true);
  });

  it.each([
    ["openai", "gpt-5.4"],
    ["openai", "gpt-5.6-pro"],
    ["openai", "gpt-5.6-terra-preview"],
    ["openrouter", "gpt-5.6-terra"],
    ["atlas", "gpt-5.6-terra"],
  ] as const)(
    "rejects unsupported provider/model pair %s/%s",
    (provider, model) => {
      expect(supportsTextVerbosity(provider, model)).toBe(false);
    },
  );
});
