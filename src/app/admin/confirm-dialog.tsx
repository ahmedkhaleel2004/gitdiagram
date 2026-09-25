"use client";

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { TOUCH } from "./ui";

// The dashboard asks before anything that is hard to take back: resetting a
// count, opening video making to everyone, dropping a limit override, and
// recording a new Claude balance (which has a field to fill in). One dialog
// does all of them: it stays open and shows the error if the action fails.

export interface ConfirmProps {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  busyLabel: string;
  /** Runs the action; resolves to the error to show, or null when done. */
  onConfirm: () => Promise<string | null>;
  /** Fields to fill in first (the dialog is a form; Enter confirms). */
  children?: React.ReactNode;
  canConfirm?: boolean;
  /** Called once the action succeeded and the dialog closed. */
  onDone?: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  busyLabel,
  onConfirm,
  children,
  canConfirm = true,
  onDone,
}: ConfirmProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    const failure = await onConfirm().catch(() => "Something went wrong.");
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    onOpenChange(false);
    onDone?.();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
        setError(null);
      }}
    >
      <DialogContent className="neo-panel max-w-[calc(100%-2rem)] rounded-lg sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">{title}</DialogTitle>
          <DialogDescription className="text-[hsl(var(--neo-soft-text))]">
            {description}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canConfirm && !busy) void confirm();
          }}
          className="flex flex-col gap-4"
        >
          {children}
          {error ? (
            <p
              role="alert"
              className="text-sm font-medium text-red-700 dark:text-red-400"
            >
              {error}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onOpenChange(false);
                setError(null);
              }}
              className="neo-button-muted h-11 rounded-md px-4 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !canConfirm}
              className="neo-button h-11 rounded-md px-4 font-semibold disabled:opacity-60"
            >
              {busy ? busyLabel : confirmLabel}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A small button that opens a ConfirmDialog. */
export function ConfirmButton({
  label,
  ariaLabel,
  disabled,
  ...dialog
}: ConfirmProps & { label: string; ariaLabel?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={`neo-button-muted h-8 rounded-md px-3 text-xs font-semibold disabled:opacity-60 ${TOUCH}`}
      >
        {label}
      </button>
      <ConfirmDialog {...dialog} open={open} onOpenChange={setOpen} />
    </>
  );
}
