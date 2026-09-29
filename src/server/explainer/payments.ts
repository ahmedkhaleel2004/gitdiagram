import "server-only";

import type Stripe from "stripe";
import type * as StripeSdk from "stripe";
import { readAdmissionControls } from "~/server/admin/controls";
import { readIntEnv } from "~/server/env";
import { canGenerateVideos } from "~/server/explainer/config";
import { isNarrationAvailable } from "~/server/explainer/narration";
import { errorText, logEvent } from "~/server/log";
import { upstashCommand, upstashEval } from "~/server/storage/upstash";

// Paid videos: anyone the free rules hold back (early access, a limited
// country, a phone, a spent free limit, or a pause) may pay to have one
// repository's video made. The video is then everyone's, like any other.
//
// The payment is a Stripe Checkout Session. Stripe sends the payer back to
// the watch page with the session's id, and the generate route claims it
// there: one payment makes one video. Every way a paid video can fail ends
// in a refund: the run's own failure, a video that already exists or is being
// made, or a payer who never comes back (the sweep below, run by a cron).
//
// Redis keeps each payment's state under video:v1:paid:<session id>:
//   running:<ms>  claimed by a run that started then
//   done          the run stored its video
//   refunding     the sweep took it and is refunding
//   refunded      the money went back
// A claim is SET NX, so a payment is used once, and the sweep takes a
// payment the same way before refunding it, so it never refunds one a run
// has just claimed.

export const VIDEO_PRODUCT = "gitdiagram-video";
export const PAID_SESSION = /^cs_(?:live|test)_[A-Za-z0-9]{10,200}$/;

const KEY = (sessionId: string) => `video:v1:paid:${sessionId}`;
const STATE_TTL_SECONDS = 30 * 86_400;
// A Checkout Session is open for 30 minutes at most (Stripe's minimum).
const CHECKOUT_OPEN_SECONDS = 30 * 60;
// A payment nobody claimed by this long after its checkout opened is refunded.
const UNCLAIMED_REFUND_MS = 90 * 60_000;
// A run is over within 6 minutes (the generate route's lock); one still
// "running" long after that died without settling its payment.
const STALE_RUN_MS = 15 * 60_000;
// How far back the sweep looks at completed checkouts.
const SWEEP_WINDOW_SECONDS = 3 * 86_400;

let client: Stripe | null = null;
let stripeModule: Promise<typeof StripeSdk> | null = null;

function secretKey(): string | null {
  return process.env.STRIPE_SECRET_KEY?.trim() || null;
}

/** Stripe is set up, so videos can be sold. */
export function isVideoSaleConfigured(): boolean {
  return secretKey() !== null;
}

/** What one video costs, in US cents (Checkout shows it in local money). */
export function videoPriceCents(): number {
  return readIntEnv("VIDEO_PRICE_CENTS", 300);
}

async function stripe(): Promise<Stripe> {
  if (client) return client;
  const key = secretKey();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  stripeModule ??= import("stripe");
  const { default: StripeClient } = await stripeModule;
  client = new StripeClient(key, { maxNetworkRetries: 2, timeout: 10_000 });
  return client;
}

const sameName = (a: string | undefined, b: string) =>
  a?.toLowerCase() === b.toLowerCase();

/**
 * Open a Checkout Session for one repository's video, and answer the page to
 * send the payer to. Stripe brings them back to the video's watch page,
 * which starts the run with the session's id.
 */
export async function createVideoCheckout(params: {
  username: string;
  repo: string;
  visitorId: string;
  siteOrigin: string;
}): Promise<string> {
  const { username, repo, siteOrigin } = params;
  const watch = `${siteOrigin}/${username}/${repo}/video`;
  const metadata = {
    product: VIDEO_PRODUCT,
    owner: username,
    repo,
    visitor: params.visitorId,
  };
  const session = await (
    await stripe()
  ).checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: videoPriceCents(),
          product_data: {
            name: `Explainer video of ${username}/${repo}`,
            description:
              "A narrated one-minute video of the repository, made by GitDiagram. It stays free for everyone to watch. If it can't be made, you get your money back.",
          },
        },
      },
    ],
    // Prices in the payer's own money where Stripe supports it.
    adaptive_pricing: { enabled: true },
    submit_type: "pay",
    client_reference_id: params.visitorId,
    metadata,
    payment_intent_data: {
      description: `GitDiagram video of ${username}/${repo}`,
      metadata,
    },
    success_url: `${watch}?paid={CHECKOUT_SESSION_ID}`,
    cancel_url: watch,
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_OPEN_SECONDS,
  });
  if (!session.url) throw new Error("Stripe returned no checkout page.");
  return session.url;
}

type PaymentState = "running" | "done" | "refunding" | "refunded";

function parseState(value: string | null): {
  state: PaymentState | null;
  at: number;
} {
  if (!value) return { state: null, at: 0 };
  const [state, at] = value.split(":");
  return {
    state:
      state === "running" ||
      state === "done" ||
      state === "refunding" ||
      state === "refunded"
        ? state
        : null,
    at: Number(at) || 0,
  };
}

const paymentIntentId = (session: Stripe.Checkout.Session) =>
  typeof session.payment_intent === "string"
    ? session.payment_intent
    : (session.payment_intent?.id ?? null);

/** Give a payment's money back. Stripe refunds a payment once, whoever asks. */
async function refundSession(
  session: Stripe.Checkout.Session,
  reason: string,
): Promise<void> {
  const intent = paymentIntentId(session);
  if (!intent) throw new Error("The checkout has no payment to refund.");
  await (
    await stripe()
  ).refunds.create(
    {
      payment_intent: intent,
      reason: "requested_by_customer",
      metadata: { product: VIDEO_PRODUCT, why: reason },
    },
    { idempotencyKey: `video-refund:${session.id}` },
  );
  await upstashCommand([
    "SET",
    KEY(session.id),
    "refunded",
    "EX",
    STATE_TTL_SECONDS,
  ]);
  logEvent("info", "video.payment.refunded", {
    session: session.id,
    reason,
  });
}

export interface ClaimedPayment {
  sessionId: string;
  /** The run stored its video: the payment is spent. */
  done(): Promise<void>;
  /**
   * The run cannot make the video: give the money back. False when the
   * refund could not be made now; the sweep retries it within minutes.
   */
  refund(reason: string): Promise<boolean>;
}

export type ClaimResult =
  | { ok: true; payment: ClaimedPayment }
  | { ok: false; status: number; error: string };

/**
 * Check with Stripe that a checkout was paid for this repository's video,
 * and take it for one run. A payment is claimed once: after that, it is
 * being used, used, or refunded.
 */
export async function claimVideoPayment(
  sessionId: string,
  username: string,
  repo: string,
): Promise<ClaimResult> {
  if (!PAID_SESSION.test(sessionId))
    return { ok: false, status: 402, error: "That payment link is not valid." };
  let session: Stripe.Checkout.Session;
  try {
    session = await (await stripe()).checkout.sessions.retrieve(sessionId);
  } catch (error) {
    const missing =
      (error as { code?: string; statusCode?: number }).statusCode === 404;
    if (!missing)
      logEvent("error", "video.payment.lookup_failed", {
        error: errorText(error),
      });
    return missing
      ? { ok: false, status: 402, error: "That payment was not found." }
      : {
          ok: false,
          status: 503,
          error:
            "Your payment could not be checked just now. Reload the page to try again.",
        };
  }
  const metadata = session.metadata ?? {};
  if (
    metadata.product !== VIDEO_PRODUCT ||
    !sameName(metadata.owner, username) ||
    !sameName(metadata.repo, repo)
  )
    return {
      ok: false,
      status: 402,
      error: "That payment is for a different video.",
    };
  if (session.status !== "complete" || session.payment_status !== "paid")
    return {
      ok: false,
      status: 402,
      error: "That payment has not gone through.",
    };
  const key = KEY(session.id);
  const claimed = await upstashCommand<string | null>([
    "SET",
    key,
    `running:${Date.now()}`,
    "NX",
    "EX",
    STATE_TTL_SECONDS,
  ]);
  if (claimed !== "OK") {
    const { state } = parseState(
      await upstashCommand<string | null>(["GET", key]),
    );
    // A run already making this payer's video: the page waits for it (409).
    return state === "running"
      ? {
          ok: false,
          status: 409,
          error:
            "Your video is already being made. It will be here in about a minute.",
        }
      : {
          ok: false,
          status: 402,
          error:
            state === "done"
              ? "That payment has already made its video."
              : "That payment was refunded.",
        };
  }
  logEvent("info", "video.payment.claimed", { session: session.id });
  return {
    ok: true,
    payment: {
      sessionId: session.id,
      async done() {
        await upstashCommand([
          "SET",
          key,
          "done",
          "EX",
          STATE_TTL_SECONDS,
        ]).catch((error: unknown) =>
          logEvent("error", "video.payment.done_failed", {
            session: session.id,
            error: errorText(error),
          }),
        );
      },
      async refund(reason) {
        try {
          await refundSession(session, reason);
          return true;
        } catch (error) {
          logEvent("error", "video.payment.refund_failed", {
            session: session.id,
            reason,
            error: errorText(error),
          });
          // Left "running" and dated long ago, so the next sweep refunds it.
          await upstashCommand([
            "SET",
            key,
            "running:0",
            "EX",
            STATE_TTL_SECONDS,
          ]).catch(() => undefined);
          return false;
        }
      },
    },
  };
}

// Takes a payment for the sweep: only one nobody holds, or one whose run
// died (still "running" from before ARGV[2]). KEYS: the payment. ARGV: the
// new value, the cutoff in ms, the TTL.
const TAKE_FOR_REFUND = `
local value = redis.call('GET', KEYS[1])
if value then
  local at = string.match(value, '^running:(%d+)$')
  if not at or tonumber(at) >= tonumber(ARGV[2]) then return 0 end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[3]))
return 1
`;

/**
 * Refund paid checkouts that never made a video: the payer never came back
 * from Stripe, or the run died without settling. A run still going, or one
 * whose video was stored (`hasVideoSince`), is left alone.
 */
export async function sweepVideoPayments(
  hasVideoSince: (
    owner: string,
    repo: string,
    since: number,
  ) => Promise<boolean>,
  now = Date.now(),
): Promise<{ checked: number; refunded: number }> {
  const api = await stripe();
  let checked = 0;
  let refunded = 0;
  for await (const session of api.checkout.sessions.list({
    status: "complete",
    created: { gte: Math.floor(now / 1000) - SWEEP_WINDOW_SECONDS },
    limit: 100,
  })) {
    if (
      session.metadata?.product !== VIDEO_PRODUCT ||
      session.payment_status !== "paid"
    )
      continue;
    checked += 1;
    const key = KEY(session.id);
    const { state, at } = parseState(
      await upstashCommand<string | null>(["GET", key]),
    );
    if (state === "done" || state === "refunded") continue;
    let reason: string;
    if (state === null) {
      if (now - session.created * 1000 < UNCLAIMED_REFUND_MS) continue;
      reason = "never claimed";
    } else if (state === "running") {
      if (now - at < STALE_RUN_MS) continue;
      const { owner, repo } = session.metadata;
      if (owner && repo && at > 0 && (await hasVideoSince(owner, repo, at))) {
        await upstashCommand(["SET", key, "done", "EX", STATE_TTL_SECONDS]);
        continue;
      }
      reason = "run never finished";
    } else {
      // "refunding": an earlier sweep took it and stopped partway.
      reason = "retry";
    }
    const cutoff = now - STALE_RUN_MS;
    if (state !== "refunding") {
      const taken = await upstashEval<number>({
        script: TAKE_FOR_REFUND,
        keys: [key],
        args: ["refunding", cutoff, STATE_TTL_SECONDS],
      });
      if (taken !== 1) continue;
    }
    try {
      await refundSession(session, reason);
      refunded += 1;
    } catch (error) {
      logEvent("error", "video.payment.sweep_refund_failed", {
        session: session.id,
        error: errorText(error),
      });
    }
  }
  return { checked, refunded };
}

/**
 * Whether a video can be bought right now: Stripe is set up, selling is
 * switched on, and a paid run could be made (the models and the narrator are
 * available). The free rules do not matter here: buying is how to get past
 * them.
 */
export async function canSellVideos(): Promise<boolean> {
  if (!isVideoSaleConfigured() || !canGenerateVideos()) return false;
  try {
    const [controls, voice] = await Promise.all([
      readAdmissionControls(),
      isNarrationAvailable(),
    ]);
    return controls.paidVideos && voice;
  } catch {
    return false;
  }
}
