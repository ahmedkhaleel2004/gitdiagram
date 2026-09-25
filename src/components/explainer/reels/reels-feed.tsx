"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Link2,
  Network,
  Play,
  Send,
  Star,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { VideoCard, VideoPage } from "~/features/explainer/catalog-types";
import {
  cardOf,
  loadReelVideo,
  newCards,
  parseReelParam,
  reelKey,
  reelOutput,
  reelPath,
  shuffled,
} from "~/features/explainer/reels";
import type { VideoArtifact } from "~/features/explainer/types";
import { formatCompact } from "~/lib/format";
import { ReelStage, type ReelInsets } from "./reel-stage";
import styles from "./reels.module.css";

// Stages built either side of the one on screen, so a swipe lands on a
// drawn, voiced reel; videos fetched this far ahead.
const BUILT_AROUND = 1;
const FETCHED_AHEAD = 2;
// More cards are asked for when this few are left.
const LOAD_MORE_AT = 4;
const SETTLE_MS = 120;

/**
 * The reels feed: every stored video, one tall screen each, played in the
 * engine's reel layout. The first tap unlocks the sound; from then on the
 * reel on screen plays and the rest wait at their start.
 */
export function ReelsFeed({ initial }: { initial: VideoPage }) {
  const [cards, setCards] = useState(initial.cards);
  const [videos, setVideos] = useState<Record<string, VideoArtifact | null>>(
    {},
  );
  const [failed, setFailed] = useState<Record<string, true>>({});
  const [active, setActive] = useState(0);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const topBar = useRef<HTMLDivElement>(null);
  const activeRef = useRef(0);
  // A video opened by link, which the feed moves to once it is in the list.
  const landOn = useRef<string | null>(null);
  const pages = useRef({
    next: initial.page + 1,
    total: initial.totalPages,
    loading: false,
  });

  // The page behind the feed must not scroll.
  useEffect(() => {
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = overflow;
    };
  }, []);

  // A link to one video opens the feed on it.
  useEffect(() => {
    const wanted = parseReelParam(
      new URLSearchParams(window.location.search).get("v"),
    );
    if (!wanted) return;
    loadReelVideo(wanted)
      .then((video) => {
        // Only while the feed still stands at its start.
        if (!video || activeRef.current !== 0) return;
        const card = cardOf(video);
        landOn.current = reelKey(card);
        setVideos((known) => ({ ...known, [reelKey(card)]: video }));
        setCards((feed) => [
          card,
          ...feed.filter((other) => reelKey(other) !== reelKey(card)),
        ]);
      })
      .catch(() => {
        // The feed opens on its own first video instead.
      });
  }, []);

  // Scroll snapping holds on to the reel it had snapped to when one is put
  // in above it, so the feed is moved onto the linked one itself.
  useEffect(() => {
    const element = scroller.current;
    const index = cards.findIndex((card) => reelKey(card) === landOn.current);
    if (!element || index < 0) return;
    landOn.current = null;
    element.scrollTo({ top: index * element.clientHeight });
  }, [cards]);

  // The reel on screen is the one the scroll settled on.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let timer = 0;
    const settle = () => {
      window.clearTimeout(timer);
      const index = Math.round(
        element.scrollTop / Math.max(1, element.clientHeight),
      );
      if (index === activeRef.current) return;
      activeRef.current = index;
      setActive(index);
      setPaused(false);
    };
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, SETTLE_MS);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("scrollend", settle);
    return () => {
      window.clearTimeout(timer);
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("scrollend", settle);
    };
  }, []);

  // Fetch the videos around the one on screen, and more cards near the end.
  useEffect(() => {
    for (
      let index = Math.max(0, active - BUILT_AROUND);
      index <= active + FETCHED_AHEAD && index < cards.length;
      index++
    ) {
      const card = cards[index]!;
      const key = reelKey(card);
      if (key in videos) continue;
      loadReelVideo(card)
        .then((video) => setVideos((known) => ({ ...known, [key]: video })))
        .catch(() => setFailed((known) => ({ ...known, [key]: true })));
    }
    const more = pages.current;
    if (
      active < cards.length - LOAD_MORE_AT ||
      more.loading ||
      more.next > more.total
    )
      return;
    more.loading = true;
    const params = new URLSearchParams({
      sort: "stars_desc",
      page: String(more.next),
    });
    fetch(`/api/video/catalog?${params.toString()}`, { credentials: "omit" })
      .then((response) => {
        if (!response.ok) throw new Error("More videos could not be loaded.");
        return response.json() as Promise<VideoPage>;
      })
      .then((page) => {
        more.next = page.page + 1;
        more.total = page.totalPages;
        setCards((feed) => [...feed, ...newCards(feed, shuffled(page.cards))]);
      })
      .catch(() => {
        // Asked again the next time the feed moves.
      })
      .finally(() => {
        more.loading = false;
      });
  }, [active, cards, videos]);

  // The address names the reel on screen, so it can be shared as it is.
  const current = cards[active];
  useEffect(() => {
    if (current) window.history.replaceState(null, "", reelPath(current));
  }, [current]);

  // A call or another app took the sound: show the reel paused.
  useEffect(() => {
    if (!started) return;
    const { context } = reelOutput();
    const onChange = () => {
      if (context.state !== "running") setPaused(true);
    };
    context.addEventListener("statechange", onChange);
    return () => context.removeEventListener("statechange", onChange);
  }, [started]);

  useEffect(() => {
    if (started) reelOutput().destination.gain.value = muted ? 0 : 1;
  }, [muted, started]);

  /** Sound may only start inside a tap: resume the shared output there. */
  const unlock = () => {
    const session = (
      navigator as Navigator & { audioSession?: { type: string } }
    ).audioSession;
    if (session) session.type = "playback";
    reelOutput()
      .context.resume()
      .catch(() => {
        // The next tap tries again.
      });
  };

  const onTap = () => {
    unlock();
    if (!started) {
      setStarted(true);
      setPaused(false);
    } else setPaused((value) => !value);
  };

  const goTo = useCallback((index: number) => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTo({
      top: Math.max(0, index) * element.clientHeight,
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) return;
      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        goTo(activeRef.current + 1);
      } else if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        goTo(activeRef.current - 1);
      } else if (event.key === "m") setMuted((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo]);

  const topInset = () => topBar.current?.offsetHeight ?? 56;

  if (!cards.length)
    return (
      <div className={styles.shell}>
        <div className={styles.column}>
          <div className={styles.empty}>
            <p>No videos yet.</p>
            <Link href="/videos">Back to videos</Link>
          </div>
        </div>
      </div>
    );

  return (
    <div className={styles.shell}>
      <div className={styles.column}>
        <div ref={scroller} className={styles.scroller}>
          {cards.map((card, index) => {
            const key = reelKey(card);
            return (
              <ReelSlide
                key={key}
                card={card}
                video={videos[key]}
                failed={Boolean(failed[key]) || videos[key] === null}
                built={Math.abs(index - active) <= BUILT_AROUND}
                active={index === active}
                playing={index === active && started && !paused}
                shown={index === active || !started}
                showPaused={index === active && started && paused}
                topInset={topInset}
                onTap={onTap}
                onFailed={() =>
                  setFailed((known) => ({ ...known, [key]: true }))
                }
              />
            );
          })}
        </div>
        <div ref={topBar} className={styles.topBar}>
          <Link
            href="/videos"
            className={styles.back}
            aria-label="Back to videos"
          >
            <ChevronLeft size={24} strokeWidth={2.5} />
          </Link>
          <h1 className={styles.wordmark}>Reels</h1>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => {
              unlock();
              setMuted((value) => !value);
            }}
            aria-pressed={muted}
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
        </div>
        {!started && (
          <button type="button" className={styles.start} onClick={onTap}>
            <span className={styles.startPlay}>
              <Play size={34} fill="currentColor" />
            </span>
            <span className={styles.startLabel}>Tap to watch with sound</span>
          </button>
        )}
      </div>
      <div className={styles.nav}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => goTo(activeRef.current - 1)}
          disabled={active === 0}
          aria-label="Previous video"
        >
          <ChevronUp size={22} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => goTo(activeRef.current + 1)}
          disabled={active >= cards.length - 1}
          aria-label="Next video"
        >
          <ChevronDown size={22} />
        </button>
      </div>
    </div>
  );
}

function ReelSlide({
  card,
  video,
  failed,
  built,
  active,
  playing,
  shown,
  showPaused,
  topInset,
  onTap,
  onFailed,
}: {
  card: VideoCard;
  video: VideoArtifact | null | undefined;
  failed: boolean;
  built: boolean;
  active: boolean;
  playing: boolean;
  shown: boolean;
  showPaused: boolean;
  topInset: () => number;
  onTap: () => void;
  onFailed: () => void;
}) {
  const slide = useRef<HTMLElement>(null);
  const info = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const progress = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const name = `${card.owner}/${card.repo}`;
  const diagram = `/${card.owner.toLowerCase()}/${card.repo.toLowerCase()}`;

  // What the page covers of the frame, so the scene and captions keep clear.
  const insets = (): ReelInsets => {
    const box = slide.current?.getBoundingClientRect();
    const text = info.current?.getBoundingClientRect();
    const buttons = rail.current?.getBoundingClientRect();
    return {
      top: topInset(),
      bottom: box && text ? box.bottom - text.top : 140,
      right: box && buttons ? box.right - buttons.left : 64,
    };
  };

  const share = async () => {
    const url = new URL(reelPath(card), window.location.origin).toString();
    if (navigator.share) {
      await navigator
        .share({ title: `${name} explained`, url })
        .catch(() => undefined);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt("Copy this link", url);
    }
  };

  return (
    <section
      ref={slide}
      className={styles.slide}
      aria-label={`${name}: ${card.title}`}
      aria-current={active ? "true" : undefined}
    >
      <div className={styles.placeholder} aria-hidden="true">
        <p>{card.title}</p>
      </div>
      {built && video && !failed && (
        <ReelStage
          video={video}
          active={active}
          playing={playing}
          shown={shown}
          insets={insets}
          onProgress={(fraction) => {
            if (progress.current)
              progress.current.style.transform = `scaleX(${fraction})`;
          }}
          onFailed={onFailed}
        />
      )}
      <button
        type="button"
        className={styles.tap}
        onClick={onTap}
        aria-label={playing ? `Pause ${name}` : `Play ${name}`}
      >
        {showPaused && (
          <span className={styles.pausedIcon} aria-hidden="true">
            <Play size={30} fill="currentColor" />
          </span>
        )}
        {failed && (
          <span className={styles.unavailable}>
            This video could not be loaded. Swipe on.
          </span>
        )}
      </button>
      <div ref={info} className={styles.info}>
        <p className={styles.repo}>
          <span className={styles.avatar} aria-hidden="true">
            {card.owner.charAt(0).toUpperCase()}
          </span>
          <span className={styles.repoName}>{name}</span>
        </p>
        <p className={styles.title}>{card.title}</p>
        <p className={styles.meta}>
          {card.language && <span>{card.language}</span>}
          <Link href={`${diagram}/video`} className={styles.metaLink}>
            Full video
          </Link>
        </p>
      </div>
      <div ref={rail} className={styles.rail}>
        <a
          href={`https://github.com/${name}`}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.railItem}
          aria-label={`${name} on GitHub, ${card.stars.toLocaleString("en")} stars`}
        >
          <span className={styles.railIcon}>
            <Star size={21} />
          </span>
          <span className={styles.railLabel}>{formatCompact(card.stars)}</span>
        </a>
        <Link
          href={diagram}
          className={styles.railItem}
          aria-label={`Diagram of ${name}`}
        >
          <span className={styles.railIcon}>
            <Network size={21} />
          </span>
          <span className={styles.railLabel}>Diagram</span>
        </Link>
        <button
          type="button"
          className={styles.railItem}
          onClick={() => void share()}
          aria-label={`Share ${name}`}
        >
          <span className={styles.railIcon}>
            {copied ? <Link2 size={21} /> : <Send size={20} />}
          </span>
          <span className={styles.railLabel} aria-live="polite">
            {copied ? "Copied" : "Share"}
          </span>
        </button>
      </div>
      <div className={styles.progressTrack} aria-hidden="true">
        <div ref={progress} className={styles.progress} />
      </div>
    </section>
  );
}
