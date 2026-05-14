import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Loading from "~/components/loading";

describe("Loading", () => {
  it("auto-scrolls the stream pane without forcing page scroll", async () => {
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const scrollIntoView = vi.fn();

    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    };

    try {
      const { rerender } = render(
        <Loading status="started" message="Starting generation process..." />,
      );
      const streamPane = screen.getByTestId("generation-stream");
      Object.defineProperty(streamPane, "scrollHeight", {
        configurable: true,
        value: 1200,
      });

      rerender(
        <Loading
          status="explanation_chunk"
          message="Analyzing repository structure..."
          explanation="Streaming explanation..."
        />,
      );

      await waitFor(() => {
        expect(streamPane.scrollTop).toBe(1200);
      });
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
      window.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });
});
