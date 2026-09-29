"use client";

import { useId, useState, type ReactNode } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

import type {
  CredentialKind,
  CredentialStatus,
} from "~/features/credentials/api";
import { useCredentialSetting } from "~/hooks/use-credential-setting";
import { GITHUB_REPO_URL } from "~/lib/site";

import controls from "./generation/workspace.module.css";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

const CREDENTIAL_LABELS = {
  openai_api_key: {
    noun: "key",
    name: "API key",
    inputLabel: "OpenAI API key",
    placeholder: "sk-...",
    saved: "Key saved. Paste a new one to replace it.",
  },
  github_pat: {
    noun: "token",
    name: "GitHub token",
    inputLabel: "GitHub personal access token",
    placeholder: "github_pat_...",
    saved: "Token saved. Paste a new one to replace it.",
  },
} as const;

interface CredentialDialogProps {
  credential: CredentialKind;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
  title: string;
  description: string;
  setup: {
    instructions: ReactNode;
    url: string;
    linkLabel: string;
    aiPrompt: string;
  };
  dataUsage: ReactNode;
  /**
   * A preferred way in, shown above the pasted-credential steps, which then
   * stay folded behind `alternativeLabel` until opened (or while a pasted
   * credential is saved).
   */
  primary?: (context: CredentialDialogPrimaryContext) => ReactNode;
  alternativeLabel?: string;
}

export interface CredentialDialogPrimaryContext {
  status: CredentialStatus | null;
  disconnectGitHub: () => Promise<boolean>;
  isPending: boolean;
  pendingAction: ReturnType<typeof useCredentialSetting>["pendingAction"];
}

export function CredentialDialog({
  credential,
  isOpen,
  onClose,
  onSaved,
  title,
  description,
  setup,
  dataUsage,
  primary,
  alternativeLabel,
}: CredentialDialogProps) {
  const inputId = useId();
  const hintId = useId();
  const labels = CREDENTIAL_LABELS[credential];
  const [showAlternative, setShowAlternative] = useState(false);
  const {
    clear,
    disconnectGitHub,
    error,
    isConfigured,
    isPending,
    pendingAction,
    save,
    setValue,
    status,
    value,
  } = useCredentialSetting({ credential, isOpen });
  const errors = {
    load: `Could not load the saved-${labels.noun} status.`,
    save: `Could not save the ${labels.name}. Please try again.`,
    clear: `Could not clear the ${labels.name}. Please try again.`,
    disconnect: "Could not disconnect GitHub. Please try again.",
  };
  const showForm = !primary || showAlternative || isConfigured;
  const errorAlert = error && (
    <p
      role="alert"
      className="text-sm font-medium text-red-700 dark:text-red-300"
    >
      {errors[error]}
    </p>
  );
  const dataUsageDetails = (
    <details className="text-xs text-neutral-700 dark:text-neutral-300">
      <summary className="neo-link w-fit cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-offset-4">
        How your data is used
      </summary>
      <p className="mt-2 leading-relaxed">
        {dataUsage} You can also{" "}
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="neo-link underline"
        >
          self-host
        </a>
        .
      </p>
    </details>
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isPending || !value.trim()) return;
    if (await save()) {
      onClose();
      await onSaved?.();
    }
  };

  const handleClear = async () => {
    if (await clear()) {
      if (onSaved) {
        onClose();
        await onSaved();
      }
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className={`neo-panel ${controls.controlsTheme} max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-lg p-5 sm:max-w-md sm:p-6`}
        onOpenAutoFocus={(event) => {
          // Radix skips links when it picks what to focus; a primary action
          // that is a link marks itself so it still gets the first focus.
          const target = (
            event.currentTarget as HTMLElement | null
          )?.querySelector<HTMLElement>("[data-dialog-autofocus]");
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <DialogHeader className="text-left">
          <DialogTitle className="pr-6 text-xl font-bold">{title}</DialogTitle>
          <DialogDescription className="text-sm text-neutral-700 dark:text-neutral-300">
            {description}
          </DialogDescription>
        </DialogHeader>
        {primary?.({ status, disconnectGitHub, isPending, pendingAction })}
        {!showForm && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setShowAlternative(true)}
              className="neo-link min-h-10 text-sm font-medium underline focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              {alternativeLabel}
            </button>
            {dataUsageDetails}
            {errorAlert}
          </div>
        )}
        {showForm && (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-3">
              <h3 className="text-sm font-bold">1. Create a {labels.noun}</h3>
              <p className="text-sm text-neutral-700 dark:text-neutral-300">
                {setup.instructions}
              </p>
              <a
                href={setup.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`${controls.actionButton} ${controls.primary} w-full`}
              >
                {setup.linkLabel}
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
              <CopySetupPrompt prompt={setup.aiPrompt} />
            </div>
            <div className="space-y-2">
              <label htmlFor={inputId} className="block text-sm font-bold">
                2. Paste your {labels.noun}
              </label>
              <Input
                id={inputId}
                type="password"
                aria-label={labels.inputLabel}
                aria-describedby={hintId}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={
                  isConfigured
                    ? `Paste a replacement ${labels.noun}`
                    : labels.placeholder
                }
                value={value}
                onChange={(event) => setValue(event.target.value)}
                disabled={isPending}
                className="ph-no-capture neo-input h-11 rounded-md px-3 py-2 text-base placeholder:font-normal placeholder:text-gray-600 dark:placeholder:text-neutral-400"
                required
              />
              <p
                id={hintId}
                className="pt-1 text-xs text-neutral-700 dark:text-neutral-300"
              >
                {isConfigured
                  ? labels.saved
                  : "Saved in this browser for 30 days. Clear it anytime."}
              </p>
            </div>
            {dataUsageDetails}
            {errorAlert}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              {isConfigured && (
                <button
                  type="button"
                  onClick={() => void handleClear()}
                  disabled={isPending}
                  className="neo-link min-h-10 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pendingAction === "clear"
                    ? "Clearing..."
                    : `Clear ${labels.noun}`}
                </button>
              )}
              <div className="ml-auto grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isPending}
                  className={controls.actionButton}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!value.trim() || isPending}
                  className={`${controls.actionButton} ${controls.primary}`}
                >
                  {pendingAction === "save"
                    ? "Saving..."
                    : onSaved
                      ? "Save & retry"
                      : `Save ${labels.noun}`}
                </button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CopySetupPrompt({ prompt }: { prompt: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void copyPrompt()}
        className={`${controls.actionButton} w-full`}
      >
        {status === "copied" ? (
          <Check size={16} aria-hidden="true" />
        ) : (
          <Copy size={16} aria-hidden="true" />
        )}
        <span aria-live="polite">
          {status === "copied"
            ? "Copied! Paste into your AI"
            : "Copy prompt for my AI"}
        </span>
      </button>
      {status === "failed" && (
        <div className="space-y-2">
          <p role="alert" className="text-sm">
            Couldn’t copy. Select the prompt below to copy it manually.
          </p>
          <textarea
            aria-label="AI setup prompt"
            readOnly
            value={prompt}
            onFocus={(event) => event.currentTarget.select()}
            className="neo-input min-h-28 w-full rounded-md p-3 text-sm"
          />
        </div>
      )}
    </>
  );
}
