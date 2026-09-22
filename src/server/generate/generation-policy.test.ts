import { describe, expect, it } from "vitest";
import {
  getArchitectureReasoningEffort,
  GRAPH_REASONING_EFFORT,
} from "./generation-policy";

describe("architecture reasoning policy", () => {
  it.each(["gpt-6-luna", "gpt-6-luna-2026-09-22", " GPT-6-LUNA "])(
    "uses the measured low-effort setting for %s",
    (model) => {
      expect(getArchitectureReasoningEffort(model)).toBe("low");
    },
  );
  it.each([
    "gpt-5.6-luna",
    "gpt-5.6-luna-2026-07-09",
    "gpt-5.6-terra",
    "gpt-6-luna-preview",
  ])("preserves reasoning for explicit model %s", (model) => {
    expect(getArchitectureReasoningEffort(model)).toBe("medium");
  });
  it("retains medium reasoning for graph repairs", () => {
    expect(GRAPH_REASONING_EFFORT).toBe("medium");
  });
});
