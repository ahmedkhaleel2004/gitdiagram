import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CSPostHogProvider } from "~/app/providers";

const mocks = vi.hoisted(() => ({
  captureAnalyticsEvent: vi.fn(),
  migrateLegacyCredentialStorage: vi.fn(),
  webVitals: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/browse"),
  useSearchParams: vi.fn(() => new URLSearchParams("q=react")),
}));
vi.mock("next-themes", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("~/components/web-vitals", () => ({
  WebVitals: () => {
    mocks.webVitals();
    return null;
  },
}));
vi.mock("~/features/credentials/api", () => ({
  migrateLegacyCredentialStorage: mocks.migrateLegacyCredentialStorage,
}));
vi.mock("~/lib/analytics-client", () => ({
  captureAnalyticsEvent: mocks.captureAnalyticsEvent,
}));

describe("CSPostHogProvider credential migration gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the app immediately but starts analytics only after migration", async () => {
    let completeMigration!: (complete: boolean) => void;
    mocks.migrateLegacyCredentialStorage.mockReturnValue(
      new Promise<boolean>((resolve) => {
        completeMigration = resolve;
      }),
    );

    render(
      <CSPostHogProvider>
        <main>Application content</main>
      </CSPostHogProvider>,
    );

    expect(screen.getByText("Application content")).toBeInTheDocument();
    expect(mocks.migrateLegacyCredentialStorage).toHaveBeenCalledOnce();
    expect(mocks.captureAnalyticsEvent).not.toHaveBeenCalled();
    expect(mocks.webVitals).not.toHaveBeenCalled();

    completeMigration(true);

    await waitFor(() => expect(mocks.webVitals).toHaveBeenCalledOnce());
    expect(mocks.captureAnalyticsEvent).toHaveBeenCalledWith("$pageview", {
      $current_url: "http://localhost:3000/browse?q=react",
    });
  });

  it("keeps analytics disabled after a failed migration", async () => {
    mocks.migrateLegacyCredentialStorage.mockResolvedValue(false);

    render(
      <CSPostHogProvider>
        <main>Application content</main>
      </CSPostHogProvider>,
    );

    expect(screen.getByText("Application content")).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.migrateLegacyCredentialStorage).toHaveBeenCalledOnce(),
    );
    expect(mocks.captureAnalyticsEvent).not.toHaveBeenCalled();
    expect(mocks.webVitals).not.toHaveBeenCalled();
  });
});
