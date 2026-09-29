import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("/.well-known/*", () => {
  it("answers 404 JSON, so OAuth discovery finds no metadata", async () => {
    const response = GET();
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "not_found" });
  });
});
