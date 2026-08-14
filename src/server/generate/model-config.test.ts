import { afterEach, describe, expect, it } from "vitest";

import {
  getApiKeyEnvVar,
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
  it("recognizes OpenRouter as a first-class provider", () => {
    process.env.AI_PROVIDER = "openrouter";

    expect(getProvider()).toBe("openrouter");
    expect(getProviderLabel("openrouter")).toBe("OpenRouter");
  });

  it("recognizes OrcaRouter as a first-class provider", () => {
    process.env.AI_PROVIDER = "orcarouter";

    expect(getProvider()).toBe("orcarouter");
    expect(getProviderLabel("orcarouter")).toBe("OrcaRouter");
  });

  it("falls back to OpenAI for an unknown provider name", () => {
    process.env.AI_PROVIDER = "not-a-provider";

    expect(getProvider()).toBe("openai");
  });
});

describe("getApiKeyEnvVar", () => {
  it.each([
    ["openai", "OPENAI_API_KEY"],
    ["openrouter", "OPENROUTER_API_KEY"],
    ["orcarouter", "ORCAROUTER_API_KEY"],
  ] as const)("maps %s onto %s", (provider, envVar) => {
    expect(getApiKeyEnvVar(provider)).toBe(envVar);
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

  it("uses GPT-5.6 Terra as the OrcaRouter fallback", () => {
    delete process.env.ORCAROUTER_MODEL;

    expect(getModel("orcarouter")).toBe("openai/gpt-5.6-terra");
  });

  it("preserves an explicit OrcaRouter model override", () => {
    process.env.ORCAROUTER_MODEL = "openai/gpt-5.6-luna";

    expect(getModel("orcarouter")).toBe("openai/gpt-5.6-luna");
  });
});

describe("shouldUseExactInputTokenCount", () => {
  it.each(["openrouter", "orcarouter"] as const)(
    "keeps %s on the conservative local token fallback",
    (provider) => {
      expect(
        shouldUseExactInputTokenCount({
          provider,
          apiKey: "apikey-test",
        }),
      ).toBe(false);
    },
  );
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
    ["orcarouter", "gpt-5.6-terra"],
  ] as const)(
    "rejects unsupported provider/model pair %s/%s",
    (provider, model) => {
      expect(supportsTextVerbosity(provider, model)).toBe(false);
    },
  );
});
