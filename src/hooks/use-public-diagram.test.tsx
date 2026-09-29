import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readRecentDiagrams } from "~/features/recent/recent-diagrams";
import { usePublicDiagram } from "./use-public-diagram";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("usePublicDiagram", () => {
  it("trusts a stored public diagram the server rendered, without a request", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() =>
      usePublicDiagram({
        owner: "acme",
        repo: "demo",
        ready: true,
        knownPublicAt: "2026-09-01T00:00:00.000Z",
      }),
    );

    expect(result.current).toEqual({
      owner: "acme",
      repo: "demo",
      lastSuccessfulAt: "2026-09-01T00:00:00.000Z",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readRecentDiagrams()[0]).toMatchObject({
      owner: "acme",
      repo: "demo",
    });
  });

  it("asks the public preview once a new diagram is ready", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ diagram: "x", lastSuccessfulAt: "2026-09-02" }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(
      ({ ready }) => usePublicDiagram({ owner: "acme", repo: "demo", ready }),
      { initialProps: { ready: false } },
    );
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ ready: true });
    await waitFor(() =>
      expect(result.current?.lastSuccessfulAt).toBe("2026-09-02"),
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "/api/diagram-preview?username=acme&repo=demo",
    );
    expect(readRecentDiagrams()).toHaveLength(1);
  });

  it("never offers or remembers a diagram the public preview does not have", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() =>
      usePublicDiagram({ owner: "acme", repo: "private", ready: true }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toBeNull();
    expect(readRecentDiagrams()).toEqual([]);
  });

  it("treats a failed check as private", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { result } = renderHook(() =>
      usePublicDiagram({ owner: "acme", repo: "demo", ready: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toBeNull();
    expect(readRecentDiagrams()).toEqual([]);
  });
});
