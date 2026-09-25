"use client";

import { useState } from "react";
import Link from "next/link";
import { Play, Star } from "lucide-react";
import type { VideoCard } from "~/features/explainer/catalog-types";
import styles from "./video-grid.module.css";

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function Poster({ card }: { card: VideoCard }) {
  const [failed, setFailed] = useState(false);
  const src = `/api/video/file?${new URLSearchParams({
    username: card.owner,
    repo: card.repo,
    format: "still",
    v: card.createdAt,
    ...(card.posterAt ? { p: String(card.posterAt) } : {}),
  }).toString()}`;
  return (
    <div className={styles.poster}>
      {failed ? (
        <div className={styles.fallback} aria-hidden="true">
          {card.title}
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- posters are stored renders, already sized
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          // An image that failed before hydration never fires onError.
          ref={(image) => {
            if (image?.complete && image.naturalWidth === 0) setFailed(true);
          }}
          onError={() => setFailed(true)}
        />
      )}
      <span className={styles.play} aria-hidden="true">
        <Play size={20} fill="currentColor" />
      </span>
      <span className={styles.duration}>
        {Math.floor(card.durationSeconds / 60)}:
        {String(card.durationSeconds % 60).padStart(2, "0")}
      </span>
    </div>
  );
}

/** Poster cards for every stored explainer video. */
export function VideoGrid({ cards }: { cards: VideoCard[] }) {
  if (!cards.length)
    return (
      <p className="text-[hsl(var(--neo-soft-text))]">
        No videos yet. Open any repository on GitDiagram and press Video.
      </p>
    );
  return (
    <ul className={styles.grid}>
      {cards.map((card, index) => (
        <li
          key={`${card.owner}/${card.repo}`}
          style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
          className={styles.item}
        >
          <Link
            href={`/${card.owner.toLowerCase()}/${card.repo.toLowerCase()}/video`}
            className={`neo-panel ${styles.card}`}
          >
            <Poster card={card} />
            <div className={styles.body}>
              <div className={styles.repo}>
                {card.owner}/<strong>{card.repo}</strong>
              </div>
              {card.opening && <p className={styles.opening}>{card.opening}</p>}
              <div className={styles.facts}>
                {card.stars > 0 && (
                  <span>
                    <Star size={12} aria-hidden="true" />
                    {compact.format(card.stars).toLowerCase()}
                  </span>
                )}
                {card.language && <span>{card.language}</span>}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
