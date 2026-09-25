import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canGenerateVideos } from "./config";
import { choosePlanner, premiumPlanner } from "./planner";

const OPUS = { model: "claude-opus-5-5", effort: "low" };
const SOL = { model: "gpt-6-sol", effort: "medium" };
// Opus writes the script, Sol designs the scenes.
const STANDARD = { ...OPUS, designer: SOL };
// Opus writes and designs; Sol takes over both if Opus fails.
const PREMIUM = { ...OPUS, fallback: SOL };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function choose(overrides: Partial<Parameters<typeof choosePlanner>[0]> = {}) {
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  return choosePlanner({
    operator: false,
    stars: 100,
    priority: false,
    takePremium: vi.fn(async () => ({ refund: vi.fn(async () => undefined) })),
    ...overrides,
  });
}

describe("choosing the video planner", () => {
  it("gives everyone else the Opus-and-Sol planner without touching the premium count", async () => {
    const takePremium = vi.fn();
    const choice = await choose({ takePremium });
    expect(choice.planner).toEqual(STANDARD);
    expect(takePremium).not.toHaveBeenCalled();
  });

  it("gives a priority visitor Opus while their premium video lasts", async () => {
    const first = await choose({ priority: true });
    expect(first.planner).toEqual(PREMIUM);
    expect(first.refund).toBeTypeOf("function");
    const later = await choose({
      priority: true,
      takePremium: vi.fn(async () => null),
    });
    expect(later.planner).toEqual(STANDARD);
  });

  it("makes popular repositories and the operator's videos with Opus", async () => {
    const takePremium = vi.fn();
    expect((await choose({ stars: 10_000, takePremium })).planner).toEqual(
      PREMIUM,
    );
    expect((await choose({ operator: true, takePremium })).planner).toEqual(
      PREMIUM,
    );
    expect(takePremium).not.toHaveBeenCalled();
  });

  it("never gives a visitor from a limited country Opus alone", async () => {
    const takePremium = vi.fn();
    const choice = await choose({
      stars: 50_000,
      priority: true,
      standardOnly: true,
      takePremium,
    });
    expect(choice.planner).toEqual(STANDARD);
    expect(takePremium).not.toHaveBeenCalled();
  });

  it("falls back to the standard planner when the premium count cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const choice = await choose({
      priority: true,
      takePremium: vi.fn(async () => {
        throw new Error("redis down");
      }),
    });
    expect(choice.planner).toEqual(STANDARD);
  });

  it("lets Sol write the standard script too when configured", async () => {
    vi.stubEnv("VIDEO_STANDARD_DIRECTOR_MODEL", "gpt-6-sol");
    expect((await choose()).planner).toEqual(SOL);
  });

  it("gives Opus no stand-in without an OpenAI key", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(premiumPlanner()).toEqual(OPUS);
  });
});

describe("whether videos can be made", () => {
  const keys = (anthropic: string, openai: string) => {
    vi.stubEnv("ANTHROPIC_API_KEY", anthropic);
    vi.stubEnv("OPENAI_API_KEY", openai);
    vi.stubEnv("OPENROUTER_API_KEY", "or-test");
  };

  it("needs the key of every configured model's provider", () => {
    keys("sk-ant", "sk-test");
    expect(canGenerateVideos()).toBe(true);
    keys("", "sk-test");
    expect(canGenerateVideos()).toBe(false);
  });

  it("needs no Claude key when every model is a GPT", () => {
    keys("", "sk-test");
    vi.stubEnv("VIDEO_PLANNER_MODEL", "gpt-6-sol");
    vi.stubEnv("VIDEO_STANDARD_DIRECTOR_MODEL", "gpt-6-sol");
    expect(canGenerateVideos()).toBe(true);
  });
});
