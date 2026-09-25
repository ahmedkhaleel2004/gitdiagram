import { describe, expect, it } from "vitest";

import { networkOf } from "./network";

describe("networkOf", () => {
  it("keeps IPv4 and IPv4-mapped addresses whole", () => {
    expect(networkOf("203.0.113.9")).toBe("203.0.113.9");
    expect(networkOf("::ffff:203.0.113.9")).toBe("::ffff:203.0.113.9");
  });

  it("collapses IPv6 to its /64 by default", () => {
    expect(networkOf("2001:DB8:1:2:3:4:5:6")).toBe("2001:0db8:0001:0002::/64");
    expect(networkOf("2001:db8:1:2::9")).toBe("2001:0db8:0001:0002::/64");
    expect(networkOf("2001:db8::")).toBe("2001:0db8:0000:0000::/64");
    expect(networkOf("::1")).toBe("0000:0000:0000:0000::/64");
  });

  it("collapses IPv6 to a /48 when asked", () => {
    expect(networkOf("2001:db8:1:2:3:4:5:6", 48)).toBe("2001:0db8:0001::/48");
    expect(networkOf("2001:db8:1:ff00::1", 48)).toBe("2001:0db8:0001::/48");
  });

  it("leaves malformed addresses whole", () => {
    expect(networkOf("2001:db8:1")).toBe("2001:db8:1");
    expect(networkOf(" 10.0.0.1 ")).toBe("10.0.0.1");
  });
});
