import type {
  CapturedNetworkRequest,
  PostHog,
  PostHogConfig,
} from "posthog-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  setPersonPropertiesForFlags: vi.fn(),
  setDeviceProperties: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("posthog-js/full/no-external", () => ({ default: mocks }));
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
    expect(mocks.init.mock.calls[0]![1]).toMatchObject({
      disable_external_dependency_loading: true,
      disable_session_recording: false,
    });
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

  it("preserves replay page metadata while excluding network requests and URL secrets", async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({ country: "CA", region: "ON" }),
    );
    const { captureAnalyticsEvent } = await import("./analytics-client");
    captureAnalyticsEvent("$pageview");
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledOnce());
    const config = mocks.init.mock.calls[0]![1] as PostHogConfig;
    const mask = config.session_recording.maskCapturedNetworkRequestFn!;
    // The SDK's _maskUrl passes this partial shape despite its public type.
    expect(
      mask({
        name: "https://gitdiagram.com/owner/repo?token=secret#private",
      } as CapturedNetworkRequest),
    ).toEqual({ name: "https://gitdiagram.com/owner/repo" });
    for (const request of [
      {
        name: "https://gitdiagram.com/api/generate",
        method: "POST",
        requestBody: "secret",
      },
      { name: "https://gitdiagram.com/", isInitial: true },
      {
        name: "https://gitdiagram.com/asset",
        entryType: "resource",
        duration: 10,
        startTime: 0,
      },
    ]) {
      expect(mask(request as CapturedNetworkRequest)).toBeNull();
    }
    expect(config.session_recording.recordHeaders).toBe(false);
    expect(config.session_recording.recordBody).toBe(false);
    expect(config.capture_performance).toEqual({
      web_vitals: true,
      network_timing: false,
    });
  });
});
