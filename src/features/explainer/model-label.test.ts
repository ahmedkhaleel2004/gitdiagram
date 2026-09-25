import { describe, expect, it } from "vitest";
import { modelLabel, modelLabels } from "./model-label";

describe("model labels", () => {
  it("names one model, or the director and the designers' model", () => {
    expect(modelLabel("claude-opus-5-5")).toBe("Claude Opus 5.5");
    expect(modelLabel("claude-opus-5-5+gpt-6-sol")).toBe(
      "Claude Opus 5.5 and GPT-6 Sol",
    );
    expect(modelLabels("claude-opus-5-5+gpt-6-sol")).toEqual([
      "Claude Opus 5.5",
      "GPT-6 Sol",
    ]);
  });
});
