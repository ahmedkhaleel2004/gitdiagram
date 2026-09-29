import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VideoArtifact } from "~/features/explainer/types";

const video = {
  createdAt: "2026-09-24T00:00:00.000Z",
  meta: { owner: "acme", repo: "tiny" },
  stats: { model: "claude-opus-5-5" },
  timing: { DURATION: 58.4 },
} as unknown as VideoArtifact;

function stubFetch(canSend: boolean) {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
    Response.json(
      init?.method === "POST" ? { ok: true } : { ok: true, canSend },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

// Whether the button is offered is asked once per page load, so each test
// loads the share row afresh.
const loadShare = async () =>
  (await import("~/components/explainer/explainer-share")).ExplainerShare;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("video feedback", () => {
  it("is offered where the server says so, and sends the moment on screen", async () => {
    const fetch = stubFetch(true);
    const ExplainerShare = await loadShare();
    render(<ExplainerShare video={video} position={() => 12.34} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Send feedback" }),
    );
    fireEvent.change(
      screen.getByLabelText("What did you think of this video?"),
      {
        target: { value: " More diagrams please " },
      },
    );
    const form = screen
      .getByLabelText("What did you think of this video?")
      .closest("form")!;
    fireEvent.submit(form);
    await screen.findByText(/I read every one/);
    const [, init] = fetch.mock.calls.find(([, init]) => init?.method)!;
    expect(JSON.parse(String(init!.body))).toEqual({
      username: "acme",
      repo: "tiny",
      message: "More diagrams please",
      email: "",
      at: 12.3,
    });
  });

  it("stays hidden elsewhere", async () => {
    const fetch = stubFetch(false);
    const ExplainerShare = await loadShare();
    render(<ExplainerShare video={video} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Send feedback" })).toBeNull();
  });
});
