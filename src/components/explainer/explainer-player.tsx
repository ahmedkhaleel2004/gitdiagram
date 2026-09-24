"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Captions,
  CaptionsOff,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { ExplainerAudio, type SfxCue } from "~/features/explainer/audio-mixer";
import { STAGE_PATH } from "~/features/explainer/engine";
import type { VideoArtifact } from "~/features/explainer/types";
import styles from "./explainer-video.module.css";

type StageMessage =
  | { type: "stage-ready" }
  | { type: "ready"; duration: number; sfx: SfxCue[] }
  | { type: "error"; message: string };

const STAGE_TIMEOUT_MS = 20_000;
const CAPTIONS_KEY = "gitdiagram.video.captions";

const formatTime = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/**
 * Plays an explainer live: the scene engine runs in a sandboxed same-origin
 * frame, the audio mixes in this page, and every frame seeks the scene
 * timeline to the audio clock so picture and sound cannot drift.
 */
export function ExplainerPlayer({ artifact }: { artifact: VideoArtifact }) {
  const shell = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const audio = useRef<ExplainerAudio | null>(null);
  const scrubber = useRef<HTMLInputElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [captions, setCaptions] = useState(
    () => window.localStorage.getItem(CAPTIONS_KEY) === "1",
  );
  // iPhone Safari cannot put an element in fullscreen; fill the window instead.
  const [expanded, setExpanded] = useState(false);
  const captionsRef = useRef(captions);
  const duration = artifact.timing.DURATION;

  const seekStage = useCallback(
    (time: number) => {
      frame.current?.contentWindow?.postMessage(
        { type: "seek", time },
        window.location.origin,
      );
      if (scrubber.current) scrubber.current.value = String(time);
      if (clock.current)
        clock.current.textContent = `${formatTime(time)} / ${formatTime(duration)}`;
    },
    [duration],
  );

  // Scale the fixed 1920×1080 stage to whatever width the page gives it.
  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    const resize = () =>
      element.style.setProperty(
        "--stage-scale",
        String(element.clientWidth / 1920),
      );
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Hand the plan to the stage, then load the audio the stage says it needs.
  useEffect(() => {
    let cancelled = false;
    // Never spin forever: a stage that neither loads nor reports an error fails.
    const timeout = window.setTimeout(() => {
      if (!cancelled) setError("The video took too long to load.");
    }, STAGE_TIMEOUT_MS);
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
        // Poster: show the finished opening scene until the viewer presses play.
        frame.current?.contentWindow?.postMessage(
          {
            type: "seek",
            time: Math.max(0, (artifact.timing.beats[0]?.end ?? 4) - 0.2),
          },
          window.location.origin,
        );
        const mixer = new ExplainerAudio(artifact, message.sfx);
        audio.current = mixer;
        mixer
          .load()
          .then(() => {
            window.clearTimeout(timeout);
            if (!cancelled) setReady(true);
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

  const toggleCaptions = () => {
    const next = !captions;
    captionsRef.current = next;
    setCaptions(next);
    window.localStorage.setItem(CAPTIONS_KEY, next ? "1" : "0");
    frame.current?.contentWindow?.postMessage(
      { type: "captions", on: next },
      window.location.origin,
    );
  };

  const toggleFullscreen = () => {
    const element = shell.current;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (document.fullscreenEnabled && element.requestFullscreen)
      void element.requestFullscreen();
    else setExpanded((value) => !value);
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
      <div ref={wrapper} className={styles.player}>
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
            <span className={styles.loading}>
              {error}{" "}
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
            onClick={toggle}
            disabled={!ready}
            aria-label={playing ? "Pause explainer" : "Play explainer"}
          >
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
                <span className={styles.loading}>Loading video…</span>
              ))}
          </button>
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
        <span ref={clock} className={styles.time}>
          {`0:00 / ${formatTime(duration)}`}
        </span>
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
          aria-label={expanded ? "Exit full screen" : "Full screen"}
        >
          {expanded ? <Minimize size={17} /> : <Maximize size={17} />}
        </button>
      </div>
    </div>
  );
}
