"use client";

import { useEffect, useRef, useState } from "react";
import { Check, type LucideIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import styles from "./workspace.module.css";

export function ExportAction({
  label,
  successLabel,
  announcement,
  description,
  errorMessage,
  icon: Icon,
  onAction,
}: {
  label: string;
  successLabel: string;
  announcement: string;
  description: string;
  errorMessage: string;
  icon: LucideIcon;
  onAction: () => Promise<void>;
}) {
  const [status, setStatus] = useState<"idle" | "busy" | "success" | "error">(
    "idle",
  );
  const [pointerMotion, setPointerMotion] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (reset.current) clearTimeout(reset.current);
    },
    [],
  );
  const success = status === "success";
  return (
    <div className={styles.exportAction} data-motion={pointerMotion}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={styles.exportActionButton}
            aria-label={label}
            aria-busy={status === "busy"}
            disabled={status === "busy"}
            onPointerEnter={() => setPointerMotion(true)}
            onPointerDown={() => setPointerMotion(true)}
            onKeyDown={() => setPointerMotion(false)}
            onFocus={(event) => {
              if (event.currentTarget.matches(":focus-visible"))
                setPointerMotion(false);
            }}
            onClick={async (event) => {
              setPointerMotion(event.detail !== 0);
              if (reset.current) clearTimeout(reset.current);
              setStatus("busy");
              try {
                await onAction();
                setStatus("success");
                reset.current = setTimeout(() => setStatus("idle"), 2000);
              } catch {
                setStatus("error");
              }
            }}
          >
            <span className={styles.exportButtonContent} aria-hidden="true">
              <span className={styles.exportButtonState} data-active={!success}>
                <Icon size={16} />
                {label}
              </span>
              <span className={styles.exportButtonState} data-active={success}>
                <Check size={16} />
                {successLabel}
              </span>
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent
          className={styles.exportTooltip}
          data-motion={pointerMotion}
          sideOffset={8}
        >
          {description}
        </TooltipContent>
      </Tooltip>
      <span
        className={status === "error" ? styles.exportError : "sr-only"}
        role={status === "success" || status === "error" ? "status" : undefined}
        aria-live="polite"
      >
        {success ? announcement : status === "error" ? errorMessage : ""}
      </span>
    </div>
  );
}
