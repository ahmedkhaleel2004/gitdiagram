"use client";

import Image from "next/image";
import { Trigger } from "@radix-ui/react-dialog";
import { ArrowUpRight, Expand } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "~/components/ui/dialog";
import type { SponsorSurface } from "./sponsor-content";
import styles from "./sponsor-placement-preview.module.css";

export function SponsorPlacementPreview({
  name,
  preview,
}: Pick<SponsorSurface, "name" | "preview">) {
  return (
    <Dialog>
      <Trigger asChild>
        <button
          type="button"
          className={styles.trigger}
          aria-label={`View placement: ${name}`}
        >
          <Expand aria-hidden="true" />
          View placement
        </button>
      </Trigger>
      <DialogContent className={styles.dialog}>
        <div className={styles.heading}>
          <DialogTitle className={styles.title}>{name}</DialogTitle>
          <DialogDescription className={styles.description}>
            {preview.caption}
          </DialogDescription>
        </div>
        <div className={styles.imageContainer}>
          <div className={styles.imageStage}>
            <Image
              src={preview.src}
              alt={preview.alt}
              width={preview.width}
              height={preview.height}
              className={styles.image}
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
        </div>
        <div className={styles.footer}>
          <p>Current desktop placement</p>
          <a href={preview.src} target="_blank" rel="noopener noreferrer">
            Open full size
            <ArrowUpRight aria-hidden="true" />
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
