import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readVisitor, VISITOR_COOKIE, withVisitorCookie } from "./visitor";

const ID = "0b6f3a52-6a1f-4a8e-9a3c-2f0d7c1e5b44";
const request = (cookie?: string) =>
  new Request("https://gitdiagram.com/api/video/generate", {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });

describe("video visitor", () => {
  it("keeps the id a browser already has", () => {
    expect(
      readVisitor(request(`other=1; ${VISITOR_COOKIE}=${ID}; more=2`)),
    ).toEqual({ id: ID, fresh: false });
  });

  it("gives a new browser a new id and sets it once", () => {
    const visitor = readVisitor(request());
    expect(visitor.fresh).toBe(true);
    expect(visitor.id).not.toBe(ID);
    const response = withVisitorCookie(Response.json({}), visitor);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${VISITOR_COOKIE}=${visitor.id}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/");

    const known = { id: ID, fresh: false };
    expect(
      withVisitorCookie(Response.json({}), known).headers.get("set-cookie"),
    ).toBeNull();
  });

  it("replaces ids it did not make", () => {
    const visitor = readVisitor(request(`${VISITOR_COOKIE}=../../all`));
    expect(visitor.fresh).toBe(true);
    expect(visitor.id).not.toContain("/");
  });
});
