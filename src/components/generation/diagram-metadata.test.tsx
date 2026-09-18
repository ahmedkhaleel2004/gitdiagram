import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DiagramMetadata } from "./diagram-metadata";

afterEach(cleanup);

it("reveals the local timestamp once without displaying a server format first", async () => {
  const date = new Date("2026-09-18T08:32:40Z");
  const element = <DiagramMetadata lastGenerated={date} />;
  const container = document.createElement("div");
  container.innerHTML = renderToString(element);
  document.body.append(container);
  const time = container.querySelector("time")!;
  expect(time.textContent).toBe("");
  expect(time.parentElement).toHaveAttribute("data-hydrated", "false");
  const recoverableError = vi.fn();
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, element, {
      onRecoverableError: recoverableError,
    });
  });
  expect(recoverableError).not.toHaveBeenCalled();
  expect(time.textContent).not.toBe("");
  expect(time.textContent).not.toContain("UTC");
  expect(time).toHaveAttribute("dateTime", date.toISOString());
  expect(time.parentElement).toHaveAttribute("data-hydrated", "true");
  await act(async () => root.unmount());
  container.remove();
});

it("keeps cost visible when an old diagram has no saved date", () => {
  render(
    <DiagramMetadata
      cost={{
        kind: "actual",
        approximate: false,
        amountUsd: 0.01,
        display: "$0.0100 USD",
        pricingModel: "test",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }}
    />,
  );
  expect(screen.getByText("Actual cost: $0.0100 USD")).toBeVisible();
  expect(document.querySelector("time")).toBeNull();
});
