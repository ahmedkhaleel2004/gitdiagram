"use client";

import { useReportWebVitals } from "next/web-vitals";

import { captureAnalyticsEvent } from "~/lib/analytics-client";

type ReportWebVitalsCallback = Parameters<typeof useReportWebVitals>[0];

const TRACKED_WEB_VITALS = new Set(["CLS", "FCP", "INP", "LCP", "TTFB"]);

const reportWebVital: ReportWebVitalsCallback = (metric) => {
  if (!TRACKED_WEB_VITALS.has(metric.name)) return;

  captureAnalyticsEvent("web_vital", {
    id: metric.id,
    label: metric.label,
    name: metric.name,
    start_time: metric.startTime,
    value: metric.value,
  });
};

export function WebVitals() {
  useReportWebVitals(reportWebVital);
  return null;
}
