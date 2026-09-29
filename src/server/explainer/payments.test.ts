// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redis: new Map<string, string>(),
  create: vi.fn(),
  retrieve: vi.fn(),
  list: vi.fn(),
  refund: vi.fn(),
  readAdmissionControls: vi.fn(),
  isNarrationAvailable: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("stripe", () => ({
  default: class {
    checkout = {
      sessions: {
        create: mocks.create,
        retrieve: mocks.retrieve,
        list: mocks.list,
      },
    };
    refunds = { create: mocks.refund };
  },
}));
// Just the commands payments.ts sends, kept in a Map.
vi.mock("~/server/storage/upstash", () => ({
  upstashCommand: async ([command, key, value, ...rest]: string[]) => {
    if (command === "GET") return mocks.redis.get(key!) ?? null;
    if (command === "SET") {
      if (rest.includes("NX") && mocks.redis.has(key!)) return null;
      mocks.redis.set(key!, value!);
      return "OK";
    }
    throw new Error(`unexpected ${command}`);
  },
  // TAKE_FOR_REFUND: only a payment nobody holds, or a run dated before the cutoff.
  upstashEval: async ({ keys, args }: { keys: string[]; args: unknown[] }) => {
    const value = mocks.redis.get(keys[0]!);
    if (value !== undefined) {
      const at = /^running:(\d+)$/.exec(value)?.[1];
      if (at === undefined || Number(at) >= Number(args[1])) return 0;
    }
    mocks.redis.set(keys[0]!, String(args[0]));
    return 1;
  },
}));
vi.mock("~/server/admin/controls", () => ({
  readAdmissionControls: mocks.readAdmissionControls,
}));
vi.mock("~/server/explainer/config", () => ({
  canGenerateVideos: () => true,
}));
vi.mock("~/server/explainer/narration", () => ({
  isNarrationAvailable: mocks.isNarrationAvailable,
}));

import {
  canSellVideos,
  claimVideoPayment,
  createVideoCheckout,
  sweepVideoPayments,
  VIDEO_PRODUCT,
} from "./payments";

const SESSION = "cs_live_a1B2c3D4e5F6g7H8";
const NOW = Date.parse("2026-09-29T20:00:00Z");

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION,
    status: "complete",
    payment_status: "paid",
    payment_intent: "pi_123",
    created: NOW / 1000 - 3 * 3600,
    metadata: { product: VIDEO_PRODUCT, owner: "Acme", repo: "Demo" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_SECRET_KEY", "rk_test_key");
  mocks.redis.clear();
  mocks.retrieve.mockResolvedValue(session());
  mocks.refund.mockResolvedValue({ id: "re_1" });
  mocks.readAdmissionControls.mockResolvedValue({ paidVideos: true });
  mocks.isNarrationAvailable.mockResolvedValue(true);
});

describe("createVideoCheckout", () => {
  it("opens a checkout in local money that returns to the watch page", async () => {
    mocks.create.mockResolvedValue({ url: "https://checkout.stripe.com/c/1" });
    const url = await createVideoCheckout({
      username: "acme",
      repo: "demo",
      visitorId: "visitor-1",
      siteOrigin: "https://gitdiagram.com",
    });
    expect(url).toBe("https://checkout.stripe.com/c/1");
    const params = mocks.create.mock.calls[0]![0];
    expect(params).toMatchObject({
      mode: "payment",
      adaptive_pricing: { enabled: true },
      success_url:
        "https://gitdiagram.com/acme/demo/video?paid={CHECKOUT_SESSION_ID}",
      cancel_url: "https://gitdiagram.com/acme/demo/video",
      metadata: { product: VIDEO_PRODUCT, owner: "acme", repo: "demo" },
    });
    expect(params.line_items[0].price_data).toMatchObject({
      currency: "usd",
      unit_amount: 300,
    });
  });
});

describe("claimVideoPayment", () => {
  it("claims a paid checkout for its repository once", async () => {
    const first = await claimVideoPayment(SESSION, "acme", "demo");
    expect(first.ok).toBe(true);
    const second = await claimVideoPayment(SESSION, "acme", "demo");
    expect(second).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses a checkout for another repository, or one not paid", async () => {
    expect(await claimVideoPayment(SESSION, "acme", "other")).toMatchObject({
      ok: false,
      status: 402,
    });
    mocks.retrieve.mockResolvedValue(session({ payment_status: "unpaid" }));
    expect(await claimVideoPayment(SESSION, "acme", "demo")).toMatchObject({
      ok: false,
      status: 402,
    });
    expect(mocks.redis.size).toBe(0);
  });

  it("says a used payment made its video and a refunded one was refunded", async () => {
    const claim = await claimVideoPayment(SESSION, "acme", "demo");
    if (!claim.ok) throw new Error("not claimed");
    await claim.payment.done();
    expect(await claimVideoPayment(SESSION, "acme", "demo")).toMatchObject({
      status: 402,
      error: "That payment has already made its video.",
    });
    mocks.redis.set(`video:v1:paid:${SESSION}`, "refunded");
    expect(await claimVideoPayment(SESSION, "acme", "demo")).toMatchObject({
      status: 402,
      error: "That payment was refunded.",
    });
  });

  it("refunds once, and leaves a failed refund for the sweep", async () => {
    const claim = await claimVideoPayment(SESSION, "acme", "demo");
    if (!claim.ok) throw new Error("not claimed");
    expect(await claim.payment.refund("run failed")).toBe(true);
    expect(mocks.refund).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_123" }),
      { idempotencyKey: `video-refund:${SESSION}` },
    );
    expect(mocks.redis.get(`video:v1:paid:${SESSION}`)).toBe("refunded");

    mocks.redis.clear();
    mocks.refund.mockRejectedValue(new Error("stripe down"));
    const again = await claimVideoPayment(SESSION, "acme", "demo");
    if (!again.ok) throw new Error("not claimed");
    expect(await again.payment.refund("run failed")).toBe(false);
    expect(mocks.redis.get(`video:v1:paid:${SESSION}`)).toBe("running:0");
  });
});

describe("sweepVideoPayments", () => {
  const listOf = (...sessions: unknown[]) =>
    mocks.list.mockReturnValue(
      (async function* () {
        yield* sessions;
      })(),
    );
  const noVideo = async () => false;

  it("refunds a paid checkout nobody came back to use", async () => {
    listOf(session());
    expect(await sweepVideoPayments(noVideo, NOW)).toEqual({
      checked: 1,
      refunded: 1,
    });
    expect(mocks.redis.get(`video:v1:paid:${SESSION}`)).toBe("refunded");
  });

  it("leaves recent, running, used and other checkouts alone", async () => {
    listOf(
      session({ created: NOW / 1000 - 60 }),
      session({ id: "cs_live_running0000", created: NOW / 1000 - 7200 }),
      session({ id: "cs_live_done00000000" }),
      session({ id: "cs_live_sponsor00000", metadata: { product: "ad" } }),
    );
    mocks.redis.set(
      "video:v1:paid:cs_live_running0000",
      `running:${NOW - 60_000}`,
    );
    mocks.redis.set("video:v1:paid:cs_live_done00000000", "done");
    expect(await sweepVideoPayments(noVideo, NOW)).toEqual({
      checked: 3,
      refunded: 0,
    });
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it("refunds a run that died, unless it stored its video", async () => {
    const started = NOW - 30 * 60_000;
    listOf(session());
    mocks.redis.set(`video:v1:paid:${SESSION}`, `running:${started}`);
    const hasVideo = vi.fn(async () => true);
    expect(await sweepVideoPayments(hasVideo, NOW)).toMatchObject({
      refunded: 0,
    });
    expect(hasVideo).toHaveBeenCalledWith("Acme", "Demo", started);
    expect(mocks.redis.get(`video:v1:paid:${SESSION}`)).toBe("done");

    listOf(session());
    mocks.redis.set(`video:v1:paid:${SESSION}`, `running:${started}`);
    expect(await sweepVideoPayments(noVideo, NOW)).toMatchObject({
      refunded: 1,
    });
  });
});

describe("canSellVideos", () => {
  it("needs Stripe, the switch and the narrator", async () => {
    expect(await canSellVideos()).toBe(true);
    mocks.readAdmissionControls.mockResolvedValue({ paidVideos: false });
    expect(await canSellVideos()).toBe(false);
    mocks.readAdmissionControls.mockResolvedValue({ paidVideos: true });
    mocks.isNarrationAvailable.mockResolvedValue(false);
    expect(await canSellVideos()).toBe(false);
    mocks.isNarrationAvailable.mockRejectedValue(new Error("redis down"));
    expect(await canSellVideos()).toBe(false);
  });
});
