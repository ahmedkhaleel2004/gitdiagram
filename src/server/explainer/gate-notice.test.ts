import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tasks: [] as Array<() => Promise<void>>,
  emitLiveEvent: vi.fn(async () => undefined),
  firstGateNotice: vi.fn(),
  isPublicRepository: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  after: (task: () => Promise<void>) => mocks.tasks.push(task),
}));
vi.mock("~/server/admin/live-events", () => ({
  emitLiveEvent: mocks.emitLiveEvent,
  requestOrigin: () => ({ country: "US" }),
}));
vi.mock("./limits", () => ({ firstGateNotice: mocks.firstGateNotice }));
vi.mock("./repository", () => ({
  isPublicRepository: mocks.isPublicRepository,
}));

import { reportHeldBack } from "./gate-notice";

const request = new Request("https://gitdiagram.com/api/video", {
  headers: { "x-forwarded-for": "203.0.113.9" },
});
const notice = {
  username: "acme",
  repo: "demo",
  reason: "place",
  step: "page",
};

async function report() {
  reportHeldBack(request, notice);
  for (const task of mocks.tasks.splice(0)) await task();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.firstGateNotice.mockResolvedValue(true);
  mocks.isPublicRepository.mockResolvedValue(true);
});

describe("reportHeldBack", () => {
  it("names a public repository once per connection", async () => {
    await report();
    expect(mocks.firstGateNotice).toHaveBeenCalledWith({
      clientIp: "203.0.113.9",
      repository: "acme/demo",
      step: "page",
    });
    expect(mocks.emitLiveEvent).toHaveBeenCalledWith({
      kind: "video.gated",
      repo: "acme/demo",
      reason: "place",
      step: "page",
      country: "US",
    });

    mocks.firstGateNotice.mockResolvedValue(false);
    await report();
    expect(mocks.emitLiveEvent).toHaveBeenCalledTimes(1);
  });

  it("keeps a repository it cannot confirm public unnamed", async () => {
    mocks.isPublicRepository.mockResolvedValue(false);
    await report();
    expect(mocks.emitLiveEvent).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "a repository" }),
    );
  });
});
