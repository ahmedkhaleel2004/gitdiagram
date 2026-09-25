"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { ExplainerAudio, type SfxCue } from "~/features/explainer/audio-mixer";
import { STAGE_PATH } from "~/features/explainer/engine";
import { reelOutput } from "~/features/explainer/reels";
import type { VideoArtifact } from "~/features/explainer/types";
import styles from "./reels.module.css";

type StageMessage =
  | { type: "stage-ready" }
  | { type: "ready"; duration: number; sfx: SfxCue[] }
  | { type: "error"; message: string };

/** How much of each edge the page's own buttons and text cover (CSS pixels). */
export interface ReelInsets {
  top: number;
  bottom: number;
  right: number;
}

/**
 * One reel: the scene engine in its tall layout, with the narration mixed
 * into the feed's shared output. Plays while `playing`, loops at the end, and
 * goes back to its start once it leaves the screen. Until the feed starts it
 * shows its opening scene built; after that only while `shown` (the feed
 * shows a title card for reels waiting their turn).
 */
export function ReelStage({
  video,
  active,
  playing,
  shown,
  insets,
  onProgress,
  onFailed,
}: {
  video: VideoArtifact;
  active: boolean;
  playing: boolean;
  shown: boolean;
  insets: () => ReelInsets;
  /** How far through the reel is (0 to 1), every frame while it plays. */
  onProgress: (fraction: number) => void;
  onFailed: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const mixer = useRef<ExplainerAudio | null>(null);
  const [drawn, setDrawn] = useState(false);
  const [ready, setReady] = useState(false);
  const duration = video.timing.DURATION;
  // Until it plays, a reel shows its opening scene built, not an empty frame.
  const opening = Math.max(0, (video.timing.beats[0]?.end ?? 4) - 0.2);

  const show = useCallback((time: number) => {
    frame.current?.contentWindow?.postMessage(
      { type: "seek", time },
      window.location.origin,
    );
  }, []);

  const setProgress = useEffectEvent((time: number) =>
    onProgress(Math.min(1, time / duration)),
  );

  // Read when the stage asks, so the handshake below runs once per video.
  const readInsets = useEffectEvent(insets);
  const reportFailure = useEffectEvent(onFailed);

  useEffect(() => {
    let cancelled = false;
    const fail = () => {
      if (!cancelled) reportFailure();
    };
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
            spec: video.plan,
            meta: video.meta,
            timing: video.timing,
            captions: true,
            layout: "reel",
            insets: readInsets(),
          },
          window.location.origin,
        );
      } else if (message.type === "ready") {
        show(opening);
        setDrawn(true);
        const audio = new ExplainerAudio(video, message.sfx, 2, reelOutput());
        mixer.current = audio;
        audio
          .load()
          .then(() => {
            if (!cancelled) setReady(true);
          })
          .catch(fail);
      } else if (message.type === "error") {
        console.error(`Reel stage: ${message.message}`);
        fail();
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      cancelled = true;
      window.removeEventListener("message", onMessage);
      mixer.current?.dispose();
      mixer.current = null;
    };
  }, [video, opening, show]);

  // Playing: the picture follows the sound's clock every frame, and the
  // reel starts over at its end.
  useEffect(() => {
    const audio = mixer.current;
    if (!ready || !audio || !playing) return;
    let stopped = false;
    let restarting = false;
    let frameId = 0;
    const start = (from: number) => {
      restarting = true;
      audio
        .play(from)
        .catch((error: unknown) => {
          console.error("Reel audio could not start", error);
          return false;
        })
        .finally(() => {
          restarting = false;
        });
    };
    const loop = () => {
      if (stopped) return;
      if (!restarting && audio.isPlaying) {
        const time = audio.currentTime();
        if (time >= duration - 0.05) {
          start(0);
          show(0);
          setProgress(0);
        } else {
          show(time);
          setProgress(time);
        }
      }
      frameId = requestAnimationFrame(loop);
    };
    const from = audio.currentTime();
    start(from >= duration - 0.05 ? 0 : from);
    frameId = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      cancelAnimationFrame(frameId);
      audio.pause();
    };
  }, [ready, playing, duration, show]);

  // Off screen, a reel waits at its start for the next time it comes round.
  useEffect(() => {
    if (active || !ready) return;
    mixer.current?.seek(0);
    show(0);
    setProgress(0);
  }, [active, ready, show]);

  return (
    <iframe
      ref={frame}
      className={styles.stage}
      data-shown={drawn && shown ? "true" : undefined}
      src={STAGE_PATH}
      title={`${video.meta.owner}/${video.meta.repo} explained`}
      // Same-origin by design; the stage's own CSP (script files only, no
      // inline script, no network) is the boundary for model-written text.
      referrerPolicy="no-referrer"
      tabIndex={-1}
      aria-hidden="true"
    />
  );
}
