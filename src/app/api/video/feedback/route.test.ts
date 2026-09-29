// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: true,
  canSend: vi.fn(),
  send: vi.fn(),
  take: vi.fn(),
  read: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("~/server/explainer/config", () => ({
  isVideoExplainerEnabled: () => mocks.enabled,
}));
vi.mock("~/server/explainer/feedback", () => ({
  canSendFeedback: mocks.canSend,
  sendVideoFeedback: mocks.send,
}));
vi.mock("~/server/explainer/limits", () => ({
  takeFeedbackSend: mocks.take,
}));
vi.mock("~/server/explainer/store", () => ({
  readVideoArtifact: mocks.read,
}));
vi.mock("~/server/admin/live-events", () => ({
  emitLiveEvent: mocks.emit,
  requestOrigin: () => ({ country: "CA", region: "ON", city: "Toronto" }),
}));

import { GET, POST } from "./route";

const URL = "https://gitdiagram.com/api/video/feedback";

const post = (body: unknown, origin = "https://gitdiagram.com") =>
  POST(
    new Request(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(body),
    }),
  );

const feedback = {
  username: "acme",
  repo: "widgets",
  message: "  The third scene went by too fast.  ",
  email: "",
  at: 42.5,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
  mocks.canSend.mockResolvedValue(true);
  mocks.send.mockResolvedValue(undefined);
  mocks.take.mockResolvedValue({ ok: true, retryAfterSeconds: 0 });
  mocks.emit.mockResolvedValue(undefined);
  mocks.read.mockResolvedValue({
    createdAt: "2026-09-25T12:00:00.000Z",
    meta: { owner: "Acme", repo: "Widgets" },
    timing: { DURATION: 64 },
    stats: { model: "claude-opus-5-5+gpt-6-sol" },
  });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/video/feedback", () => {
  it("tells this visitor whether they get the button, never cached", async () => {
    mocks.canSend.mockResolvedValue(false);
    const response = await GET(new Request(URL));
    expect(await response.json()).toEqual({ ok: true, canSend: false });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("POST /api/video/feedback", () => {
  it("emails the trimmed message with the video it is about", async () => {
    const response = await post(feedback);
    expect(response.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledWith(
      {
        owner: "Acme",
        repo: "Widgets",
        message: "The third scene went by too fast.",
        email: undefined,
        at: 42.5,
        duration: 64,
        createdAt: "2026-09-25T12:00:00.000Z",
        model: "Claude Opus 5.5 and GPT-6 Sol",
      },
      expect.any(Request),
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "video.feedback", repo: "Acme/Widgets" }),
    );
  });

  it("keeps a reply address when one is left", async () => {
    await post({ ...feedback, email: "dev@example.com" });
    expect(mocks.send.mock.calls[0]![0].email).toBe("dev@example.com");
  });

  it("refuses visitors outside the priority places", async () => {
    mocks.canSend.mockResolvedValue(false);
    expect((await post(feedback)).status).toBe(403);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("refuses other sites, empty messages and bad addresses", async () => {
    expect((await post(feedback, "https://evil.example")).status).toBe(403);
    expect((await post({ ...feedback, message: "   " })).status).toBe(400);
    expect((await post({ ...feedback, email: "not an email" })).status).toBe(
      400,
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("limits how much one connection sends, and fails closed", async () => {
    mocks.take.mockResolvedValueOnce({ ok: false, retryAfterSeconds: 60 });
    expect((await post(feedback)).status).toBe(429);
    mocks.take.mockRejectedValueOnce(new Error("Redis down"));
    expect((await post(feedback)).status).toBe(503);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("only takes feedback on a video that exists", async () => {
    mocks.read.mockResolvedValue(null);
    expect((await post(feedback)).status).toBe(404);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("says so when the email could not be sent", async () => {
    mocks.send.mockRejectedValue(new Error("Resend refused"));
    expect((await post(feedback)).status).toBe(502);
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});
