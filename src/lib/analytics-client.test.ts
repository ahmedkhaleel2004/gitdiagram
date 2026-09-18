import type { PostHog, PostHogConfig } from "posthog-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  setPersonPropertiesForFlags: vi.fn(),
  setDeviceProperties: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("posthog-js", () => ({ default: mocks }));
vi.mock("posthog-js/customizations", () => ({
  setAllPersonProfilePropertiesAsPersonPropertiesForFlags:
    mocks.setDeviceProperties,
}));

describe("replay targeting initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "test-project-key");
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.init.mockImplementation((_key: string, config: PostHogConfig) => {
      config.loaded?.(mocks as unknown as PostHog);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("waits for region and supplies it alongside device properties before capture", async () => {
    let completeLookup!: (response: Response) => void;
    mocks.fetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        completeLookup = resolve;
      }),
    );
    const { captureAnalyticsEvent } = await import("./analytics-client");
    captureAnalyticsEvent("$pageview");
    captureAnalyticsEvent("second-event");
    expect(mocks.init).not.toHaveBeenCalled();
    completeLookup(Response.json({ country: "US", region: "WA" }));

    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(2));
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.init).toHaveBeenCalledOnce();
    expect(mocks.setPersonPropertiesForFlags).toHaveBeenCalledWith(
      { replay_region_country: "US", replay_region_code: "WA" },
      false,
    );
    expect(mocks.setDeviceProperties).toHaveBeenCalledWith(mocks);
    expect(mocks.setDeviceProperties.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.capture.mock.invocationCallOrder[0]!,
    );
  });

  it("keeps analytics available and clears stale region overrides when lookup fails", async () => {
    mocks.fetch.mockRejectedValue(new Error("request timed out"));
    const { captureAnalyticsEvent } = await import("./analytics-client");
    captureAnalyticsEvent("$pageview");
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledOnce());
    expect(mocks.setPersonPropertiesForFlags).toHaveBeenCalledWith(
      { replay_region_country: "", replay_region_code: "" },
      false,
    );
  });
});
