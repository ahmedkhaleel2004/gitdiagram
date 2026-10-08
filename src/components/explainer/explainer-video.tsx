"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleAlert, Clapperboard, RotateCcw } from "lucide-react";
import {
  formatPrice,
  startVideoCheckout,
  type ExplainerVideoState,
  type VideoPausedReason,
} from "~/features/explainer/api";
import { captureAnalyticsEvent } from "~/lib/analytics-client";
import { lookUpStoredVideo } from "~/features/explainer/stored-video";
import {
  clearVideoRun,
  releaseVideoRun,
  startVideoRun,
  useVideoRun,
  type VideoRun,
} from "~/features/explainer/runs";
import type { VideoGenerationStage } from "~/features/explainer/types";
import { useAdminTools } from "~/features/admin/tools";
import { modelLabel, modelLabels } from "~/features/explainer/model-label";
import { ActivityMark } from "~/components/generation/activity-mark";
import { useGenerationClock } from "~/components/generation/generation-status";
import controls from "~/components/generation/workspace.module.css";
import { ExplainerPlayer } from "./explainer-player";
import { GenerationRows, ScriptPreview } from "./explainer-progress";
import { ExplainerShare } from "./explainer-share";
import styles from "./explainer-video.module.css";

const STAGE_TITLES: Record<VideoGenerationStage, string> = {
  reading: "Reading the code",
  planning: "Writing the script",
  designing: "Designing the scenes and recording the voice",
  saving: "Saving the video",
};

function isTouchMac() {
  return navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent);
}

const PAUSED: Record<VideoPausedReason, string> = {
  audience:
    "Making new videos is in early access in a few places for now. Every video already made is free to watch.",
  device:
    "Making new videos needs a computer here for now. Every video already made is free to watch.",
  limit:
    "Today's free videos have all been made. Check back tomorrow; every video already made is free to watch.",
};

/** The same, when this visitor can buy the video instead. */
const PAYABLE: Record<VideoPausedReason, string> = {
  audience: "Free videos are in early access in a few places for now.",
  device: "Free videos need a computer here for now.",
  limit: "Today's free videos are used up.",
};

// The checkout session Stripe sends a payer back with (see payments.ts).
const PAID_SESSION = /^cs_(?:live|test)_[A-Za-z0-9]{10,200}$/;

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function paidSessionInAddress(): string | undefined {
  const value = new URLSearchParams(window.location.search).get("paid");
  return value && PAID_SESSION.test(value) ? value : undefined;
}

// A stored video belongs to everyone: only the operator, with admin controls
// turned on in /admin, can replace one (or anyone in local development).
const DEVELOPMENT = process.env.NODE_ENV === "development";

/** Whether this browser should offer "Regenerate video". */
function useCanRegenerate(): boolean {
  const adminTools = useAdminTools();
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    if (DEVELOPMENT || !adminTools) return;
    const controller = new AbortController();
    // The switch is only this browser's preference; the session decides.
    fetch("/api/admin/session", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => response.json() as Promise<{ admin?: boolean }>)
      .then((body) => setAdmin(body.admin === true))
      .catch(() => undefined);
    return () => controller.abort();
  }, [adminTools]);
  return DEVELOPMENT || (adminTools && admin);
}

// While someone else's run is being made, look for the finished video this often.
const WAITING_POLL_MS = 5_000;

type PanelState =
  | { kind: "loading" }
  /** The stored video could not be looked up; retrying only looks again. */
  | { kind: "lookupError"; message: string }
  | {
      kind: "empty";
      canGenerate: boolean;
      paused: VideoPausedReason | null;
      /** What buying the video costs in US cents, when this visitor can. */
      priceCents: number | null;
      /** The operator is previewing the page as a visitor from this country. */
      viewingAs?: string | null;
    }
  | VideoRun;

/** What the panel shows for a lookup of the stored video. */
function lookedUp({
  video,
  canGenerate,
  paused,
  anyDevice,
  generating,
  payable,
  priceCents,
  viewingAs,
}: ExplainerVideoState): PanelState {
  if (video) return { kind: "ready", video };
  if (generating) return { kind: "waiting" };
  const price = payable ? priceCents : null;
  // iPads report a desktop Mac to the server; hold them back when this
  // visitor was let in only as a desktop. They can still buy the video.
  if (isTouchMac() && !anyDevice)
    return {
      kind: "empty",
      canGenerate: false,
      paused: "device",
      priceCents: price,
      viewingAs,
    };
  return { kind: "empty", canGenerate, paused, priceCents: price, viewingAs };
}

function Elapsed({ startedAt }: { startedAt: number }) {
  const { seconds } = useGenerationClock({
    running: true,
    paused: false,
    startedAt,
  });
  return (
    <span
      className={controls.elapsed}
      aria-label={`${seconds} seconds elapsed`}
    >
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

/** Who is making the film, and roughly how long it takes. */
function MakingLine({ model, repo }: { model?: string; repo: string }) {
  const [director, designer] = model ? modelLabels(model) : [];
  if (director && designer)
    return (
      <>
        {director} writes the script for {repo}, and {designer} designs every
        scene while the narration is recorded. Usually about a minute.
      </>
    );
  return (
    <>
      {director ?? "GitDiagram"} reads {repo}, writes a script and designs every
      scene while the narration is recorded.{" "}
      {model?.startsWith("gpt-")
        ? "Usually a minute or two."
        : "Usually under a minute."}
    </>
  );
}

/** A player-shaped placeholder while the stored video is looked up. */
function PlayerSkeleton() {
  return (
    <div className={styles.panel} aria-busy="true">
      <div className={`${styles.player} ${styles.skeleton}`}>
        <div className={styles.skeletonLabel}>
          <ActivityMark />
          <span className={styles.shimmer}>Loading video</span>
        </div>
      </div>
    </div>
  );
}

export function ExplainerVideo({
  username,
  repo,
}: {
  username: string;
  repo: string;
}) {
  const [lookedUpState, setState] = useState<PanelState>({ kind: "loading" });
  const [lookup, setLookup] = useState(0);
  // A run this tab started outlives the panel (see runs.ts) and wins over
  // whatever the lookup found.
  const run = useVideoRun(username, repo);
  const state: PanelState = run ?? lookedUpState;
  const canRegenerate = useCanRegenerate();
  const [confirming, setConfirming] = useState(false);
  // A payer back from Stripe: their run starts instead of a lookup.
  const [paid] = useState(paidSessionInAddress);
  const [checkout, setCheckout] = useState<{
    opening: boolean;
    error?: string;
  }>({ opening: false });
  // The time on screen, so feedback can say which moment it is about.
  const position = useRef(0);
  const onTime = useCallback((time: number) => {
    position.current = time;
  }, []);

  useEffect(() => {
    if (paid) {
      startVideoRun(username, repo, undefined, paid);
      return () => releaseVideoRun(username, repo);
    }
    const controller = new AbortController();
    lookUpStoredVideo(username, repo, controller.signal)
      .then((result) => setState(lookedUp(result)))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: "lookupError",
          message:
            error instanceof Error
              ? error.message
              : "Could not load the video.",
        });
      });
    return () => {
      controller.abort();
      releaseVideoRun(username, repo);
    };
  }, [username, repo, lookup, paid]);

  // Once the paid video is here, the address is the plain watch page again,
  // fit to share.
  const ready = state.kind === "ready";
  useEffect(() => {
    if (!paid || !ready) return;
    const address = new URL(window.location.href);
    address.searchParams.delete("paid");
    window.history.replaceState(window.history.state, "", address);
  }, [paid, ready]);

  // How many people are offered the video for a price, and why.
  const offered =
    state.kind === "empty" && !state.canGenerate ? state.priceCents : null;
  const offeredFor = state.kind === "empty" ? state.paused : null;
  useEffect(() => {
    if (offered === null) return;
    captureAnalyticsEvent("video_paywall_viewed", {
      video_repo: `${username}/${repo}`,
      reason: offeredFor,
      price_cents: offered,
    });
  }, [offered, offeredFor, username, repo]);

  // A run is under way somewhere (another tab, or before a reload): look for
  // its video until it lands.
  const waiting = state.kind === "waiting";
  const paidRetries = useRef(0);
  useEffect(() => {
    if (!waiting) return;
    const controller = new AbortController();
    let busy = false;
    const timer = window.setInterval(() => {
      if (busy) return;
      busy = true;
      lookUpStoredVideo(username, repo, controller.signal)
        .then((result) => {
          if (result.generating) return;
          clearVideoRun(username, repo);
          // The run a payer was waiting for is gone and left no video (its
          // server died): ask again, and the payment makes it this time.
          if (paid && !result.video && paidRetries.current < 2) {
            paidRetries.current++;
            startVideoRun(username, repo, undefined, paid);
            return;
          }
          setState(lookedUp(result));
        })
        // A missed poll is retried on the next tick.
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    }, WAITING_POLL_MS);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [waiting, username, repo, paid]);

  const generate = () => {
    // A failed regeneration keeps the stored video, so it stays one click away.
    const previous =
      state.kind === "ready"
        ? state.video
        : state.kind === "error"
          ? state.previous
          : undefined;
    setConfirming(false);
    startVideoRun(username, repo, previous, paid);
  };

  const buy = (priceCents: number) => {
    captureAnalyticsEvent("video_checkout_clicked", {
      video_repo: `${username}/${repo}`,
      reason: offeredFor,
      price_cents: priceCents,
    });
    setCheckout({ opening: true });
    startVideoCheckout(username, repo)
      .then((url) => window.location.assign(url))
      .catch((error: unknown) =>
        setCheckout({
          opening: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not open the checkout.",
        }),
      );
  };

  const retryLookup = () => {
    setState({ kind: "loading" });
    setLookup((value) => value + 1);
  };

  if (state.kind === "loading") return <PlayerSkeleton />;

  if (state.kind === "ready") {
    const { video } = state;
    return (
      <div className={`${styles.panel} ${styles.enter}`}>
        <ExplainerPlayer
          key={video.createdAt}
          artifact={video}
          onTime={onTime}
        />
        <div className={styles.meta}>
          <span>
            {new Set(video.plan.beats.map((beat) => beat.scene)).size} scenes ·{" "}
            {Math.round(video.timing.DURATION)}s
          </span>
          <span>
            Made with {modelLabel(video.stats.model)} in{" "}
            {(video.stats.totalMs / 1000).toFixed(0)}s
          </span>
          {canRegenerate &&
            (confirming ? (
              <span className={styles.metaConfirm}>
                Replace this video for everyone?
                <button
                  type="button"
                  className={styles.metaButton}
                  onClick={generate}
                >
                  Regenerate
                </button>
                <button
                  type="button"
                  className={styles.metaButton}
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                className={styles.metaButton}
                onClick={() => setConfirming(true)}
              >
                Regenerate video
              </button>
            ))}
        </div>
        <ExplainerShare video={video} position={() => position.current} />
      </div>
    );
  }

  if (state.kind === "generating")
    return (
      <div className={`${controls.feedback} ${styles.enter}`}>
        <div className={controls.statusLine}>
          <ActivityMark />
          <h2
            className={`${controls.statusTitle} ${styles.shimmer}`}
            aria-live="polite"
            aria-atomic="true"
          >
            {STAGE_TITLES[state.stage]}
          </h2>
          <Elapsed startedAt={state.startedAt} />
        </div>
        <p className={controls.description}>
          <MakingLine model={state.progress.model} repo={repo} />
        </p>
        <div className={styles.progressBody}>
          <GenerationRows stage={state.stage} progress={state.progress} />
          {state.progress.narration && (
            <ScriptPreview lines={state.progress.narration} />
          )}
        </div>
      </div>
    );

  if (state.kind === "waiting")
    return (
      <div className={`${controls.feedback} ${styles.enter}`}>
        <div className={controls.statusLine}>
          <ActivityMark />
          <h2 className={`${controls.statusTitle} ${styles.shimmer}`}>
            This video is being made right now
          </h2>
        </div>
        <p className={controls.description}>
          It will appear here as soon as it is ready, usually in a minute or
          two.
        </p>
      </div>
    );

  if (state.kind === "lookupError")
    return (
      <div className={`${controls.feedback} ${styles.enter}`}>
        <div className={controls.statusLine}>
          <CircleAlert size={17} aria-hidden="true" />
          <div role="alert">
            <h2 className={controls.statusTitle}>{state.message}</h2>
          </div>
        </div>
        <div className={styles.cta}>
          <button
            type="button"
            className={`${controls.actionButton} ${controls.primary}`}
            onClick={retryLookup}
          >
            <RotateCcw size={15} aria-hidden="true" />
            Try again
          </button>
        </div>
      </div>
    );

  const failed = state.kind === "error";
  const paused = !failed && !state.canGenerate;
  const price = paused && state.kind === "empty" ? state.priceCents : null;
  return (
    <div className={`${controls.feedback} ${styles.enter}`}>
      <div className={controls.statusLine}>
        {failed ? (
          <CircleAlert size={17} aria-hidden="true" />
        ) : (
          <Clapperboard size={17} aria-hidden="true" />
        )}
        {failed ? (
          // The alert wraps the heading so it keeps its heading role.
          <div role="alert">
            <h2 className={controls.statusTitle}>{state.message}</h2>
          </div>
        ) : (
          <h2 className={controls.statusTitle}>
            There&apos;s no video of {repo} yet
          </h2>
        )}
      </div>
      {!failed && (
        <p className={controls.description}>
          {paused
            ? price !== null
              ? `${PAYABLE[state.paused ?? "limit"]} You can still have this one made for ${formatPrice(price)}, and it will be free for everyone to watch.`
              : PAUSED[state.paused ?? "limit"]
            : "A narrated 90-second tour: what the project does, how its parts fit together, and a few of the decisions inside."}
        </p>
      )}
      <div className={styles.cta}>
        {paused && price !== null && (
          <button
            type="button"
            className={`${controls.actionButton} ${controls.primary}`}
            onClick={() => buy(price)}
            disabled={checkout.opening}
          >
            <Clapperboard size={15} aria-hidden="true" />
            {checkout.opening
              ? "Opening checkout…"
              : `Make it for ${formatPrice(price)}`}
          </button>
        )}
        {paused ? (
          <Link
            href="/videos"
            className={`${controls.actionButton} ${price === null ? controls.primary : ""}`}
          >
            {price === null && <Clapperboard size={15} aria-hidden="true" />}
            Watch the videos
          </Link>
        ) : (
          state.canGenerate && (
            <button
              type="button"
              className={`${controls.actionButton} ${controls.primary}`}
              onClick={generate}
            >
              <Clapperboard size={15} aria-hidden="true" />
              {failed ? "Try again" : "Make the video"}
            </button>
          )
        )}
        {failed && state.previous && (
          <button
            type="button"
            className={controls.actionButton}
            onClick={() => {
              clearVideoRun(username, repo);
              setState({ kind: "ready", video: state.previous! });
            }}
          >
            Keep the current video
          </button>
        )}
      </div>
      {checkout.error && (
        <p role="alert" className={controls.description}>
          {checkout.error}
        </p>
      )}
      {state.kind === "empty" && state.viewingAs && (
        <p className={controls.description}>
          You&apos;re seeing this as a visitor from{" "}
          {countryName(state.viewingAs)}.{" "}
          <Link href="/admin" className="underline">
            Turn it off in /admin
          </Link>
          .
        </p>
      )}
    </div>
  );
}
