import { beforeEach, describe, expect, it, vi } from "vitest";

const upstashMocks = vi.hoisted(() => ({
  command: vi.fn(),
  eval: vi.fn(),
}));

vi.mock("./upstash", () => ({
  upstashCommand: upstashMocks.command,
  upstashEval: upstashMocks.eval,
}));

import {
  acknowledgePendingBrowseIndexEntries,
  enqueuePendingBrowseIndexEntry,
  readPendingBrowseIndexEntries,
} from "./browse-index-pending";

describe("pending browse index journal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upstashMocks.command.mockResolvedValue([]);
    upstashMocks.eval.mockResolvedValue(1);
  });

  it("atomically keeps the newest entry for each repository", async () => {
    await enqueuePendingBrowseIndexEntry({
      username: "acme",
      repo: "demo",
      lastSuccessfulAt: "2026-07-24T12:00:00.000Z",
      stargazerCount: 42,
    });

    expect(upstashMocks.eval).toHaveBeenCalledWith(
      expect.objectContaining({
        keys: ["pending:v1:public-browse-index"],
        args: [
          "acme/demo",
          expect.stringMatching(/:1$/),
          expect.stringContaining(
            '"lastSuccessfulAt":"2026-07-24T12:00:00.000Z"',
          ),
        ],
      }),
    );
  });

  it("reads valid journal entries and skips malformed values", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const entry = {
      username: "acme",
      repo: "demo",
      lastSuccessfulAt: "2026-07-24T12:00:00.000Z",
      stargazerCount: 42,
    };
    const serialized = `1784919600000:1|${JSON.stringify(entry)}`;
    upstashMocks.command.mockResolvedValue([
      "acme/demo",
      serialized,
      "broken/repo",
      "1784919600000:1|{",
    ]);

    await expect(readPendingBrowseIndexEntries()).resolves.toEqual([
      {
        field: "acme/demo",
        serialized,
        entry,
      },
    ]);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("browse.index.pending_entry_invalid"),
    );
  });

  it("acknowledges only the exact journal values that were materialized", async () => {
    const pending = [
      {
        field: "acme/demo",
        serialized: '1784919600000:1|{"repo":"demo"}',
        entry: {
          username: "acme",
          repo: "demo",
          lastSuccessfulAt: "2026-07-24T12:00:00.000Z",
          stargazerCount: 42,
        },
      },
    ];

    await acknowledgePendingBrowseIndexEntries(pending);

    expect(upstashMocks.eval).toHaveBeenCalledWith(
      expect.objectContaining({
        keys: ["pending:v1:public-browse-index"],
        args: ["acme/demo", pending[0]?.serialized],
      }),
    );
  });
});
