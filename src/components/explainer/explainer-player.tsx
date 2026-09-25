"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  Captions,
  CaptionsOff,
  FastForward,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { ExplainerAudio, type SfxCue } from "~/features/explainer/audio-mixer";
import { ActivityMark } from "~/components/generation/activity-mark";
import { STAGE_PATH } from "~/features/explainer/engine";
import type { VideoArtifact } from "~/features/explainer/types";
import styles from "./explainer-video.module.css";

type StageMessage =
  | { type: "stage-ready" }
  | { type: "ready"; duration: number; sfx: SfxCue[] }
  | { type: "error"; message: string };

const STAGE_TIMEOUT_MS = 20_000;
const CAPTIONS_KEY = "gitdiagram.video.captions";
// Each press of the speed button moves to the next.
const SPEEDS = [1, 1.25, 1.5, 2, 0.75];
// Pressing and holding either side of the picture plays at this speed.
const HOLD_SPEED = 2;
const HOLD_DELAY_MS = 300;

const formatTime = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

// Preferences are best effort: storage can be blocked (private modes, strict
// cookie settings), and the player works the same without it.
function readCaptionsPreference(): boolean {
  try {
    return window.localStorage.getItem(CAPTIONS_KEY) !== "0";
  } catch {
    return true;
  }
}

function saveCaptionsPreference(on: boolean) {
  try {
    window.localStorage.setItem(CAPTIONS_KEY, on ? "1" : "0");
  } catch {
    // Not remembered; this visit still uses the choice.
  }
}

/**
 * Plays an explainer live: the scene engine runs in a same-origin frame (not
 * sandboxed; its own strict CSP is the boundary for model-written text), the
 * audio mixes in this page, and every frame seeks the scene timeline to the
 * audio clock so picture and sound cannot drift.
 */
export function ExplainerPlayer({ artifact }: { artifact: VideoArtifact }) {
  const shell = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const audio = useRef<ExplainerAudio | null>(null);
  const scrubber = useRef<HTMLInputElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const shownTime = useRef("0:00");
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Captions start on; only a visitor's own "off" choice is remembered.
  const [captions, setCaptions] = useState(readCaptionsPreference);
  // iPhone Safari cannot put an element in fullscreen; fill the window instead.
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef(0);
  // A hold ends with a click; that click must not pause the video.
  const held = useRef(false);
  const captionsRef = useRef(captions);
  const duration = artifact.timing.DURATION;

  const seekStage = useCallback((time: number) => {
    frame.current?.contentWindow?.postMessage(
      { type: "seek", time },
      window.location.origin,
    );
    if (scrubber.current) scrubber.current.value = String(time);
    // Runs every frame; the clock text only changes once a second.
    const shown = formatTime(time);
    if (clock.current && shown !== shownTime.current) {
      shownTime.current = shown;
      clock.current.textContent = shown;
    }
  }, []);

  // Full window: the page behind must not scroll, and Escape leaves.
  useEffect(() => {
    if (!expanded) return;
    const element = shell.current;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
      // Safari tints its status bar and toolbar from the full-window player
      // and keeps that black after it shrinks back, until the element leaves
      // the page. Take it out of layout for two frames, holding its space.
      const parent = element?.parentElement;
      if (!element || !parent) return;
      const minHeight = parent.style.minHeight;
      parent.style.minHeight = `${parent.offsetHeight}px`;
      element.style.display = "none";
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          element.style.display = "";
          parent.style.minHeight = minHeight;
        }),
      );
    };
  }, [expanded]);

  useEffect(() => {
    const onChange = () =>
      setFullscreen(document.fullscreenElement === shell.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Hand the plan to the stage, then load the audio the stage says it needs.
  useEffect(() => {
    let cancelled = false;
    // Never spin forever: a stage that neither loads nor reports an error
    // fails. The narration download gets its own allowance once the stage is
    // ready, and a load that finishes late still clears the message.
    let timeout = 0;
    const wait = (message: string) => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        if (!cancelled) setError(message);
      }, STAGE_TIMEOUT_MS);
    };
    wait("The video took too long to load.");
    const onMessage = (event: MessageEvent<StageMessage>) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frame.current?.contentWindow
      )
        return;
      const message = event.data;
      if (message.type === "stage-ready") {
        frame.current?.contentWindow?.postMessage(
          {
            type: "load",
            spec: artifact.plan,
            meta: artifact.meta,
            timing: artifact.timing,
            captions: captionsRef.current,
          },
          window.location.origin,
        );
      } else if (message.type === "ready") {
        // A captions toggle pressed while the stage was building.
        frame.current?.contentWindow?.postMessage(
          { type: "captions", on: captionsRef.current },
          window.location.origin,
        );
        // Poster: show the finished opening scene until the viewer presses play.
        frame.current?.contentWindow?.postMessage(
          {
            type: "seek",
            time: Math.max(0, (artifact.timing.beats[0]?.end ?? 4) - 0.2),
          },
          window.location.origin,
        );
        const mixer = new ExplainerAudio(artifact, message.sfx, HOLD_SPEED);
        // A call or an app switch stopped the sound: show the video paused.
        mixer.onInterrupted = () => {
          if (!cancelled) setPlaying(false);
        };
        audio.current = mixer;
        wait("The narration took too long to load.");
        mixer
          .load()
          .then(() => {
            window.clearTimeout(timeout);
            if (cancelled) return;
            setError(null);
            setReady(true);
          })
          .catch(() => {
            window.clearTimeout(timeout);
            if (!cancelled) setError("The narration could not be loaded.");
          });
      } else if (message.type === "error") {
        window.clearTimeout(timeout);
        console.error(`Explainer stage: ${message.message}`);
        setError("The video could not be drawn.");
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      audio.current?.dispose();
      audio.current = null;
    };
  }, [artifact, attempt]);

  const rate = holding && playing ? HOLD_SPEED : speed;
  useEffect(() => {
    if (ready) void audio.current?.setRate(rate);
  }, [rate, ready]);

  // Stretch the narration for a held press ahead of time, so it starts at once.
  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => audio.current?.prewarm(HOLD_SPEED), 500);
    return () => window.clearTimeout(id);
  }, [ready]);

  // While playing, every frame seeks the stage to the audio clock.
  useEffect(() => {
    if (!playing) return;
    let frameId = 0;
    const loop = () => {
      const mixer = audio.current;
      if (!mixer?.isPlaying) return;
      const time = mixer.currentTime();
      if (time >= duration) {
        mixer.pause();
        seekStage(duration);
        setPlaying(false);
        setEnded(true);
        return;
      }
      seekStage(time);
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [playing, duration, seekStage]);

  const play = useCallback(
    async (from?: number) => {
      const mixer = audio.current;
      if (!mixer || !ready) return;
      await mixer.play(from ?? (ended ? 0 : mixer.currentTime()));
      setEnded(false);
      setPlaying(true);
    },
    [ended, ready],
  );

  const pause = useCallback(() => {
    audio.current?.pause();
    setPlaying(false);
  }, []);

  const toggle = () => (playing ? pause() : void play());

  const cycleSpeed = () =>
    setSpeed((value) => SPEEDS[(SPEEDS.indexOf(value) + 1) % SPEEDS.length]!);

  const startHold = (event: React.PointerEvent) => {
    held.current = false;
    const side =
      event.target instanceof HTMLElement ? event.target.dataset.side : null;
    if (!playing || !side || !event.isPrimary || event.button !== 0) return;
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      held.current = true;
      setHolding(true);
    }, HOLD_DELAY_MS);
  };

  const endHold = () => {
    window.clearTimeout(holdTimer.current);
    setHolding(false);
  };

  const onSurfaceClick = () => {
    if (held.current) held.current = false;
    else toggle();
  };

  const toggleCaptions = () => {
    const next = !captions;
    captionsRef.current = next;
    setCaptions(next);
    saveCaptionsPreference(next);
    frame.current?.contentWindow?.postMessage(
      { type: "captions", on: next },
      window.location.origin,
    );
  };

  const toggleFullscreen = () => {
    const element = shell.current;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (expanded) setExpanded(false);
    else if (document.fullscreenEnabled && element.requestFullscreen)
      element.requestFullscreen().catch(() => setExpanded(true));
    else setExpanded(true);
  };

  // A fresh frame (new key) replays the whole stage handshake.
  const retry = () => {
    setError(null);
    setReady(false);
    setPlaying(false);
    setEnded(false);
    setAttempt((value) => value + 1);
  };

  const scrub = (time: number) => {
    const mixer = audio.current;
    if (!mixer) return;
    setEnded(false);
    if (mixer.isPlaying) void play(time);
    else {
      mixer.seek(time);
      seekStage(time);
    }
  };

  return (
    <div
      ref={shell}
      className={styles.shell}
      data-expanded={expanded ? "true" : undefined}
    >
      <div className={styles.player}>
        <iframe
          key={attempt}
          ref={frame}
          className={styles.stage}
          src={STAGE_PATH}
          title={`${artifact.meta.owner}/${artifact.meta.repo} explainer video`}
          // Same-origin by design; the stage's own CSP (script files only,
          // no inline script, no network) is the boundary for model-written text.
          referrerPolicy="no-referrer"
          tabIndex={-1}
          aria-hidden="true"
        />
        {error ? (
          <div className={styles.surface} role="alert">
            <span className={styles.skeletonLabel}>
              <CircleAlert size={17} aria-hidden="true" />
              {error}
              <button
                type="button"
                className={styles.metaButton}
                onClick={retry}
              >
                Try again
              </button>
            </span>
          </div>
        ) : (
          <button
            type="button"
            className={styles.surface}
            onClick={onSurfaceClick}
            onPointerDown={startHold}
            onPointerUp={endHold}
            onPointerCancel={endHold}
            onPointerLeave={endHold}
            onContextMenu={(event) => event.preventDefault()}
            disabled={!ready}
            aria-label={playing ? "Pause explainer" : "Play explainer"}
          >
            <span className={styles.holdZone} data-side="start" />
            <span className={styles.holdZone} data-side="end" />
            {!playing &&
              (ready ? (
                <span className={styles.bigPlay}>
                  {ended ? (
                    <RotateCcw size={30} />
                  ) : (
                    <Play size={34} fill="currentColor" />
                  )}
                </span>
              ) : (
                <span className={styles.skeletonLabel}>
                  <ActivityMark />
                  <span className={styles.shimmer}>Loading video</span>
                </span>
              ))}
          </button>
        )}
        {holding && playing && (
          <span className={styles.holdBadge} aria-hidden="true">
            <FastForward size={13} fill="currentColor" />
            {HOLD_SPEED}×
          </span>
        )}
      </div>
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.controlButton}
          onClick={toggle}
          disabled={!ready}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <input
          ref={scrubber}
          className={styles.scrubber}
          type="range"
          min={0}
          max={duration}
          step={0.05}
          defaultValue={0}
          disabled={!ready}
          aria-label="Seek"
          onChange={(event) => scrub(Number(event.target.value))}
        />
        <span className={styles.time}>
          <span ref={clock}>0:00</span>
          <span className={styles.total}>{` / ${formatTime(duration)}`}</span>
        </span>
        <button
          type="button"
          className={`${styles.controlButton} ${styles.speedButton}`}
          onClick={cycleSpeed}
          aria-label={`Playback speed ${speed}×, change`}
          title="Playback speed"
        >
          {speed}×
        </button>
        <button
          type="button"
          className={styles.controlButton}
          onClick={toggleCaptions}
          aria-pressed={captions}
          aria-label={captions ? "Hide captions" : "Show captions"}
        >
          {captions ? <Captions size={18} /> : <CaptionsOff size={18} />}
        </button>
        <button
          type="button"
          className={styles.controlButton}
          onClick={toggleFullscreen}
          aria-label={
            expanded || fullscreen ? "Exit full screen" : "Full screen"
          }
        >
          {expanded || fullscreen ? (
            <Minimize size={17} />
          ) : (
            <Maximize size={17} />
          )}
        </button>
      </div>
    </div>
  );
}
