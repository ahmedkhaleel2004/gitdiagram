import { describe, expect, it } from "vitest";

import { readCookie } from "./cookies";

const request = (cookie?: string) =>
  new Request("https://gitdiagram.com/", {
    headers: cookie ? { cookie } : {},
  });

describe("readCookie", () => {
  it("finds a cookie among others and keeps an = inside its value", () => {
    expect(readCookie(request("a=1; session=x.y=z; b=2"), "session")).toBe(
      "x.y=z",
    );
  });

  it("is null when the cookie is missing or there are no cookies", () => {
    expect(readCookie(request("a=1"), "session")).toBeNull();
    expect(readCookie(request(), "session")).toBeNull();
  });

  it("does not match a cookie whose name only starts the same", () => {
    expect(readCookie(request("sessionx=1"), "session")).toBeNull();
  });
});
