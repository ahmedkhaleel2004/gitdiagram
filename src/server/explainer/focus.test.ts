import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FOCUS_MAX_LENGTH, focusKey, focusSchema } from "./focus";

describe("a film's focus", () => {
  it("is trimmed, with control characters taken out", () => {
    expect(focusSchema.parse("  the\nretry\u0000 loop\t ")).toBe(
      "the retry loop",
    );
  });

  it("has invisible format characters taken out", () => {
    const zeroWidthSpace = String.fromCharCode(0x200b);
    const rightToLeftOverride = String.fromCharCode(0x202e);
    expect(
      focusSchema.parse(`the${zeroWidthSpace}retry${rightToLeftOverride}loop`),
    ).toBe("the retry loop");
  });

  it("is refused past the limit rather than cut short", () => {
    const longest = "a".repeat(FOCUS_MAX_LENGTH);
    expect(focusSchema.parse(` ${longest} `)).toBe(longest);
    expect(focusSchema.safeParse(`${longest}a`).success).toBe(false);
  });

  it("is refused when nothing is left after trimming", () => {
    expect(focusSchema.safeParse(" \n\u0007 ").success).toBe(false);
    expect(focusSchema.safeParse(42).success).toBe(false);
  });

  it("names its film with a stable key of its own", () => {
    const key = focusKey("the retry loop");
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(focusKey("the retry loop")).toBe(key);
    expect(focusKey("the cache")).not.toBe(key);
  });
});
