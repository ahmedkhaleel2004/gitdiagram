// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { feedbackEmail } from "./feedback";

const request = new Request("https://gitdiagram.com/api/video/feedback", {
  headers: {
    "x-vercel-ip-city": "San%20Francisco",
    "x-vercel-ip-country-region": "CA",
    "x-vercel-ip-country": "US",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  },
});

const feedback = {
  owner: "acme",
  repo: "widgets",
  message: "Loved it.\nThe diagram scene was the best part.",
  duration: 64.2,
  createdAt: "2026-09-25T12:00:00.000Z",
  model: "Claude Opus 5.5",
};

describe("feedbackEmail", () => {
  it("leads with the message, then says which video, moment and place", () => {
    const { subject, text } = feedbackEmail(
      { ...feedback, at: 42.4, email: "dev@example.com" },
      request,
    );
    expect(subject).toBe(
      "Video feedback on acme/widgets: Loved it. The diagram scene was the best part.",
    );
    expect(text.split("\n")).toEqual([
      "Loved it.",
      "The diagram scene was the best part.",
      "",
      "—",
      "Video: https://gitdiagram.com/acme/widgets/video",
      "Made 2026-09-25T12:00:00.000Z with Claude Opus 5.5",
      "Sent at 0:42 of 1:04",
      "From: San Francisco, CA, US · desktop",
      "Reply to: dev@example.com",
    ]);
  });

  it("shortens a long subject and says when there is no reply address", () => {
    const { subject, text } = feedbackEmail(
      { ...feedback, message: "x".repeat(200) },
      new Request("https://gitdiagram.com/"),
    );
    expect(subject).toBe(`Video feedback on acme/widgets: ${"x".repeat(60)}…`);
    expect(text).toContain("Length 1:04");
    expect(text).toContain("From: unknown place · mobile");
    expect(text).toContain("No email left");
  });
});
