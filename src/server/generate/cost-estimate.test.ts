import { beforeEach, describe, expect, it, vi } from "vitest";

const { countInputTokens } = vi.hoisted(() => ({
  countInputTokens: vi.fn(),
}));

vi.mock("~/server/generate/openai", () => ({
  countInputTokens,
  estimateTokens: (text: string) =>
    text.length === 0 ? 0 : Math.ceil(text.length / 3) + 32,
}));

import { estimateGenerationCost } from "~/server/generate/cost-estimate";

describe("estimateGenerationCost", () => {
  beforeEach(() => {
    countInputTokens.mockReset();
    countInputTokens.mockImplementation(
      async ({ userPrompt }: { userPrompt: string }) => {
        if (userPrompt.includes("<readme>")) return 100;
        if (userPrompt.includes("<file_tree>")) return 300;
        return 200;
      },
    );
  });

  it("uses the stage policy and separates first-pass from repair graph inputs", async () => {
    const result = await estimateGenerationCost({
      provider: "openai",
      model: "gpt-5.6-terra",
      fileTree: "src/main.ts\nsrc/worker.ts",
      readme: "# Demo",
      username: "acme",
      repo: "demo",
      apiKey: "sk-user",
    });

    expect(result.explanationInputTokens).toBe(100);
    expect(result.graphStaticInputTokens).toBe(200);
    expect(result.graphRepairStaticInputTokens).toBe(300);
    expect(result.estimatedInputTokens).toBe(6_300);
    expect(result.estimatedOutputTokens).toBe(12_000);

    expect(countInputTokens).toHaveBeenCalledTimes(3);
    const calls = countInputTokens.mock.calls.map(([call]) => call);
    const explanationCall = calls.find(({ userPrompt }) =>
      userPrompt.includes("<readme>"),
    );
    const firstGraphCall = calls.find(
      ({ userPrompt }) =>
        userPrompt.includes("<explanation>") &&
        !userPrompt.includes("<file_tree>"),
    );
    const repairGraphCall = calls.find(
      ({ userPrompt }) =>
        userPrompt.includes("<explanation>") &&
        userPrompt.includes("<file_tree>"),
    );

    expect(explanationCall?.reasoningEffort).toBe("medium");
    expect(firstGraphCall?.reasoningEffort).toBe("low");
    expect(repairGraphCall?.reasoningEffort).toBe("low");
    expect(firstGraphCall?.userPrompt).not.toContain("<repo_owner>");
    expect(firstGraphCall?.userPrompt).not.toContain("<repo_name>");
    expect(firstGraphCall?.userPrompt).not.toContain("<previous_graph>");
    expect(firstGraphCall?.userPrompt).not.toContain("<validation_feedback>");
    expect(repairGraphCall?.userPrompt).toContain("src/main.ts");
  });
});
