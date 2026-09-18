"use client";

import Image from "next/image";
import { useState, type CSSProperties } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, Expand } from "lucide-react";
import type { SponsorSurface } from "./sponsor-content";
import styles from "./sponsor-placement-preview.module.css";

export function SponsorPlacementPreview({
  name,
  preview,
}: Pick<SponsorSurface, "name" | "preview">) {
  const [instant, setInstant] = useState(false);

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={styles.trigger}
          aria-label={`View placement: ${name}`}
          onClick={(event) => setInstant(event.detail === 0)}
        >
          <Expand aria-hidden="true" />
          View placement
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay
          className={styles.overlay}
          data-instant={instant || undefined}
        />
        <Dialog.Content
          className={styles.dialog}
          data-instant={instant || undefined}
          onEscapeKeyDown={() => setInstant(true)}
          style={
            {
              "--preview-ratio": preview.width / preview.height,
            } as CSSProperties
          }
        >
          <div className={styles.heading}>
            <Dialog.Title className={styles.title}>{name}</Dialog.Title>
            <a
              className={styles.fullSize}
              href={preview.src}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open full size
              <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
          <Dialog.Description className="sr-only">
            {preview.caption} Click outside the image or press Escape to close.
          </Dialog.Description>
          <div className={styles.imageStage}>
            <Image
              src={preview.src}
              alt={preview.alt}
              width={preview.width}
              height={preview.height}
              className={styles.image}
              loading="eager"
              unoptimized
            />
            <svg
              className={styles.highlight}
              viewBox={`0 0 ${preview.width} ${preview.height}`}
              aria-hidden="true"
            >
              <rect
                {...preview.highlight}
                rx="10"
                fill="none"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
          <Dialog.Close
            className={styles.accessibleClose}
            onClick={() => setInstant(true)}
          >
            Close preview
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
