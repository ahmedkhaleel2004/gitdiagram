import { act } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { useHydrated } from "~/hooks/use-hydrated";

function HydrationProbe() {
  const hydrated = useHydrated();
  return <span>{hydrated ? "client" : "server"}</span>;
}

describe("useHydrated", () => {
  it("keeps the server snapshot stable through hydration before updating", async () => {
    const serverHtml = renderToString(<HydrationProbe />);
    const container = document.createElement("div");
    const recoverableErrors: unknown[] = [];
    let root: Root | undefined;

    container.innerHTML = serverHtml;
    expect(container.textContent).toBe("server");

    await act(async () => {
      root = hydrateRoot(container, <HydrationProbe />, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
      await Promise.resolve();
    });

    expect(recoverableErrors).toEqual([]);
    expect(container.textContent).toBe("client");

    await act(async () => {
      root?.unmount();
    });
  });
});
