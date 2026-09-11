import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyButton } from "~/components/copy-button";
import { TooltipProvider } from "~/components/ui/tooltip";

function renderCopyButton(onClick: () => Promise<void> | void) {
  return render(
    <TooltipProvider>
      <CopyButton onClick={onClick} />
    </TooltipProvider>,
  );
}

describe("CopyButton", () => {
  afterEach(() => {
    cleanup();
  });

  it("announces success only after the clipboard write resolves", async () => {
    let resolveCopy!: () => void;
    const onClick = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCopy = resolve;
        }),
    );
    renderCopyButton(onClick);

    fireEvent.click(
      screen.getByRole("button", { name: "Copy Mermaid.js code" }),
    );
    expect(
      screen.queryByRole("button", { name: "Mermaid code copied" }),
    ).not.toBeInTheDocument();

    resolveCopy();
    await screen.findByRole("button", { name: "Mermaid code copied" });
  });

  it("reports clipboard rejection instead of claiming success", async () => {
    renderCopyButton(() => Promise.reject(new Error("denied")));

    fireEvent.click(
      screen.getByRole("button", { name: "Copy Mermaid.js code" }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Copy failed" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Mermaid code copied" }),
    ).not.toBeInTheDocument();
  });
});
