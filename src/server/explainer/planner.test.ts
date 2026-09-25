import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { choosePlanner } from "./planner";

const OPUS = { model: "claude-opus-5-5", effort: "low" };
const SOL = { model: "gpt-6-sol", effort: "medium" };
// Opus writes the script, Sol designs the scenes.
const STANDARD = { ...OPUS, designer: SOL };

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
    expect(first.planner).toEqual(OPUS);
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
      OPUS,
    );
    expect((await choose({ operator: true, takePremium })).planner).toEqual(
      OPUS,
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

  it("uses Opus for everyone when there is no OpenAI key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const choice = await choosePlanner({
      operator: false,
      stars: 1,
      priority: false,
      takePremium: vi.fn(),
    });
    expect(choice.planner).toEqual(OPUS);
  });
});
