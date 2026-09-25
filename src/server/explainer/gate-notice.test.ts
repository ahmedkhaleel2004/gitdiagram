import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tasks: [] as Array<() => Promise<void>>,
  emitLiveEvent: vi.fn(async () => undefined),
  firstGateNotice: vi.fn(),
  takeGateLookup: vi.fn(),
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
vi.mock("./limits", () => ({
  firstGateNotice: mocks.firstGateNotice,
  takeGateLookup: mocks.takeGateLookup,
}));
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

async function report(params = notice) {
  reportHeldBack(request, params);
  for (const task of mocks.tasks.splice(0)) await task();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.firstGateNotice.mockResolvedValue(true);
  mocks.takeGateLookup.mockResolvedValue(true);
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
    expect(mocks.takeGateLookup).toHaveBeenCalledWith("203.0.113.9");
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
    // A repeated notice never counts against the lookups.
    expect(mocks.takeGateLookup).toHaveBeenCalledTimes(1);
  });

  it("keeps a repository it cannot confirm public unnamed", async () => {
    mocks.isPublicRepository.mockResolvedValue(false);
    await report();
    expect(mocks.emitLiveEvent).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "a repository" }),
    );
  });

  it("stops asking GitHub once a connection has used its lookups", async () => {
    // A connection sending many repository names only gets a few lookups.
    let left = 5;
    mocks.takeGateLookup.mockImplementation(async () => left-- > 0);
    for (let index = 0; index < 100; index++)
      await report({ ...notice, repo: `repo-${index}` });
    expect(mocks.takeGateLookup).toHaveBeenCalledTimes(100);
    expect(mocks.isPublicRepository).toHaveBeenCalledTimes(5);
    expect(mocks.emitLiveEvent).toHaveBeenCalledTimes(5);
  });
});
