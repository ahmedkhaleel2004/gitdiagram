import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WebVitals } from "~/components/web-vitals";

const { captureAnalyticsEvent, useReportWebVitals } = vi.hoisted(() => ({
  captureAnalyticsEvent: vi.fn(),
  useReportWebVitals: vi.fn(),
}));

vi.mock("next/web-vitals", () => ({ useReportWebVitals }));
vi.mock("~/lib/analytics-client", () => ({ captureAnalyticsEvent }));

describe("WebVitals", () => {
  it("reports supported metrics once through the shared analytics client", () => {
    render(<WebVitals />);

    const reporter = useReportWebVitals.mock.calls[0]?.[0];
    expect(reporter).toBeTypeOf("function");

    reporter({
      id: "metric-1",
      label: "web-vital",
      name: "LCP",
      startTime: 120,
      value: 845,
    });
    reporter({
      id: "metric-2",
      label: "custom",
      name: "Next.js-render",
      startTime: 140,
      value: 20,
    });

    expect(captureAnalyticsEvent).toHaveBeenCalledTimes(1);
    expect(captureAnalyticsEvent).toHaveBeenCalledWith("web_vital", {
      id: "metric-1",
      label: "web-vital",
      name: "LCP",
      start_time: 120,
      value: 845,
    });
  });
});
