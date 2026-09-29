import { describe, expect, it } from "vitest";

import { readmeMarkdown } from "./readme";

describe("README embeds", () => {
  it("links a picture of the current diagram to the tagged repository page", () => {
    expect(readmeMarkdown("fastapi", "fastapi", "picture")).toBe(
      "[![Architecture diagram of fastapi/fastapi](https://gitdiagram.com/fastapi/fastapi/diagram.png)](https://gitdiagram.com/fastapi/fastapi?utm_source=readme&utm_medium=picture)",
    );
  });

  it("links the shared badge to the tagged repository page", () => {
    expect(readmeMarkdown("acme", "demo.js", "badge")).toBe(
      "[![Architecture diagram](https://gitdiagram.com/diagram-badge.svg)](https://gitdiagram.com/acme/demo.js?utm_source=readme&utm_medium=badge)",
    );
  });
});
