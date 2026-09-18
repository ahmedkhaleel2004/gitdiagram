import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { GenerationActivity } from "./generation-activity";

afterEach(cleanup);

it("shows the saved explanation rather than its HTML heading and keeps markup inert", () => {
  render(
    <GenerationActivity
      state={{
        status: "complete",
        explanation:
          '<h2>Purpose and workflow</h2>\n<p>The <b>Player</b> opens the mobile game and submits guesses to the controller.</p>\n<h3>Entry point</h3>\n<ul><li>See <code>app/Home.tsx</code> for setup.</li></ul>\n<img src=x onerror="alert(1)">\n<script>alert(1)</script>',
      }}
    />,
  );
  expect(
    screen.getByText(
      "The Player opens the mobile game and submits guesses to the controller.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByText("<h2>Purpose and workflow</h2>"),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Architecture overview" }),
  );
  expect(screen.getByText("Purpose and workflow")).toBeVisible();
  expect(screen.getByText("app/Home.tsx").tagName).toBe("CODE");
  expect(document.querySelector("script, img")).toBeNull();
});
