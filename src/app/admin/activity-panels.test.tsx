import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LiveFeed } from "./activity-panels";

const events = [
  { id: 1, at: 0, kind: "diagram.started", repo: "a/diagram" },
  { id: 2, at: 0, kind: "video.started", repo: "b/video" },
  { id: 3, at: 0, kind: "render.finished", outcome: "complete" },
  { id: 4, at: 0, kind: "admin.signed_in" },
];

const titles = () =>
  screen.getAllByRole("listitem").map((item) => item.textContent ?? "");

afterEach(cleanup);

describe("the live feed's filter", () => {
  it("shows everything, only diagrams, or only videos and MP4s", () => {
    render(<LiveFeed events={events} />);
    expect(titles()).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Diagrams" }));
    expect(titles()).toEqual([expect.stringContaining("Diagram started")]);
    expect(
      screen
        .getByRole("button", { name: "Diagrams" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Videos" }));
    expect(titles()).toEqual([
      expect.stringContaining("Video started"),
      expect.stringContaining("MP4 made"),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(titles()).toHaveLength(4);
  });

  it("says when a filter has nothing yet", () => {
    render(<LiveFeed events={[events[0]!]} />);
    fireEvent.click(screen.getByRole("button", { name: "Videos" }));
    screen.getByText("No video events yet.");
  });
});
