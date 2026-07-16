import { afterEach, describe, expect, it } from "vitest";

import {
  getModel,
  getProvider,
  getProviderLabel,
  getGenerationServiceTier,
  shouldUseExactInputTokenCount,
  supportsTextVerbosity,
  usesSinglePassArchitecture,
} from "~/server/generate/model-config";

const ORIGINAL_ENV = { ...process.env };

describe("generation service tier", () => {
  it.each([
    "gpt-6-luna",
    "gpt-6-luna-2026-09-22",
    "gpt-5.6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-terra-2026-07-09",
  ])("uses Fast mode for managed %s requests", (model) => {
    expect(getGenerationServiceTier({ provider: "openai", model })).toBe(
      "priority",
    );
  });
  it("preserves standard billing for user keys and unsupported providers/models", () => {
    for (const params of [
      {
        provider: "openai" as const,
        model: "gpt-5.6-luna",
        apiKey: "user-key",
      },
      { provider: "openai" as const, model: "gpt-5.4" },
      { provider: "openrouter" as const, model: "openai/gpt-5.6-sol" },
    ])
      expect(getGenerationServiceTier(params)).toBe("default");
  });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getProvider", () => {
  it("recognizes OpenRouter as a first-class provider", () => {
    process.env.AI_PROVIDER = "openrouter";

    expect(getProvider()).toBe("openrouter");
    expect(getProviderLabel("openrouter")).toBe("OpenRouter");
  });

  it("recognizes Requesty only when selected explicitly", () => {
    process.env.AI_PROVIDER = "requesty";

    expect(getProvider()).toBe("requesty");
    expect(getProviderLabel("requesty")).toBe("Requesty");
  });
});

describe("getModel", () => {
  it("uses GPT-6 Luna as the OpenAI default", () => {
    delete process.env.OPENAI_MODEL;

    expect(getModel("openai")).toBe("gpt-6-luna");
  });

  it("preserves an explicit OpenAI model override", () => {
    process.env.OPENAI_MODEL = "gpt-5.6-terra";

    expect(getModel("openai")).toBe("gpt-5.6-terra");
  });

  it("uses GPT-5.6 Terra as the OpenRouter fallback", () => {
    delete process.env.OPENROUTER_MODEL;

    expect(getModel("openrouter")).toBe("openai/gpt-5.6-terra");
  });

  it("uses GPT-5.6 Terra as the Requesty fallback", () => {
    delete process.env.REQUESTY_MODEL;

    expect(getModel("requesty")).toBe("openai/gpt-5.6-terra");
  });

  it("preserves an explicit Requesty model override", () => {
    process.env.REQUESTY_MODEL = "anthropic/claude-sonnet-4-5";

    expect(getModel("requesty")).toBe("anthropic/claude-sonnet-4-5");
  });
});

describe("shouldUseExactInputTokenCount", () => {
  it("keeps OpenRouter on the conservative local token fallback", () => {
    expect(
      shouldUseExactInputTokenCount({
        provider: "openrouter",
        apiKey: "apikey-test",
      }),
    ).toBe(false);
  });
});

describe("supportsTextVerbosity", () => {
  it.each([
    "gpt-6-luna",
    "gpt-6-luna-2026-09-22",
    "gpt-5.6",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.6-terra-2026-07-09",
    " GPT-5.6-LUNA-2026-07-09 ",
  ])("accepts the supported OpenAI model %s", (model) => {
    expect(supportsTextVerbosity("openai", model)).toBe(true);
  });

  it.each([
    ["openai", "gpt-6-luna-preview"],
    ["openai", "gpt-6-unknown"],
    ["openai", "gpt-5.4"],
    ["openai", "gpt-5.6-pro"],
    ["openai", "gpt-5.6-terra-preview"],
    ["openrouter", "gpt-5.6-terra"],
  ] as const)(
    "rejects unsupported provider/model pair %s/%s",
    (provider, model) => {
      expect(supportsTextVerbosity(provider, model)).toBe(false);
    },
  );
});

describe("single-pass Luna architecture", () => {
  it.each(["gpt-6-luna", "gpt-6-luna-2026-09-22", "gpt-5.6-luna"])(
    "preserves one-pass generation and user-key billing for %s",
    (model) => {
      expect(usesSinglePassArchitecture({ provider: "openai", model })).toBe(
        true,
      );
      const userKey = {
        provider: "openai" as const,
        model,
        apiKey: "user-key",
      };
      expect(usesSinglePassArchitecture(userKey)).toBe(false);
      expect(getGenerationServiceTier(userKey)).toBe("default");
      expect(
        usesSinglePassArchitecture({ provider: "openrouter", model }),
      ).toBe(false);
    },
  );
});
