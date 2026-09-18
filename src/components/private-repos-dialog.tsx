"use client";

import { useId, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

import {
  useCredentialSetting,
  type CredentialSettingError,
} from "~/hooks/use-credential-setting";
import { GITHUB_REPO_URL } from "~/lib/site";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

interface PrivateReposDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
  repository?: string;
}

const ERROR_MESSAGES: Record<Exclude<CredentialSettingError, null>, string> = {
  load: "Could not load the saved-token status.",
  save: "Could not save the GitHub token. Please try again.",
  clear: "Could not clear the GitHub token. Please try again.",
};

export function PrivateReposDialog({
  isOpen,
  onClose,
  onSaved,
  repository,
}: PrivateReposDialogProps) {
  const inputId = useId();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const {
    clear,
    error,
    isConfigured,
    isPending,
    save,
    setValue: setPat,
    value: pat,
  } = useCredentialSetting({
    credential: "github_pat",
    isOpen,
  });
  const tokenUrl = new URL(
    "https://github.com/settings/personal-access-tokens/new",
  );
  tokenUrl.search = new URLSearchParams({
    name: "GitDiagram",
    description: "Read selected repositories to generate architecture diagrams",
    expires_in: "30",
    contents: "read",
    ...(repository ? { target_name: repository.split("/")[0]! } : {}),
  }).toString();
  const aiPrompt = [
    `Help me connect ${repository ? `https://github.com/${repository}` : "a private GitHub repository"} to GitDiagram.`,
    `Use my browser to open ${tokenUrl.toString()} and create a fine-grained personal access token named GitDiagram that expires in 30 days.`,
    repository
      ? `Choose the resource owner ${repository.split("/")[0]} and grant access only to the ${repository} repository.`
      : "Ask me which repository I want to use, then choose its resource owner and grant access only to that repository.",
    "Set repository Contents to Read-only; Metadata read access is included automatically. Do not add write or account permissions.",
    "If the organization requires approval, tell me what its admin needs to approve.",
    "Help me paste the token directly into GitDiagram's GitHub access dialog and save it. Do not put the token in chat, logs, or files.",
    "If you cannot use my browser, walk me through these steps briefly.",
  ].join("\n\n");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const saved = await save();
    if (saved) {
      onClose();
      onSaved?.();
    }
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(aiPrompt);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="ph-no-capture neo-panel max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-lg p-5 sm:max-w-md sm:p-6">
        <DialogHeader className="text-left">
          <DialogTitle className="pr-6 text-xl font-bold">
            GitHub access
          </DialogTitle>
          <DialogDescription className="text-sm text-neutral-700 dark:text-neutral-300">
            Use a token to let GitDiagram read your private repository.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-3">
            <h3 className="text-sm font-bold">1. Create a token</h3>
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              Choose the repository owner and select{" "}
              {repository ? (
                <strong className="break-all">{repository}</strong>
              ) : (
                "your repository"
              )}
              . <strong>Contents: Read-only</strong> is already selected.
            </p>
            <a
              href={tokenUrl.toString()}
              target="_blank"
              rel="noopener noreferrer"
              className="neo-button inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              Create token on GitHub
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
            <Button
              type="button"
              onClick={() => void copyPrompt()}
              className="neo-button-muted min-h-11 w-full"
            >
              {copyStatus === "copied" ? (
                <Check aria-hidden="true" />
              ) : (
                <Copy aria-hidden="true" />
              )}
              <span aria-live="polite">
                {copyStatus === "copied"
                  ? "Copied! Paste into your AI"
                  : "Copy prompt for my AI"}
              </span>
            </Button>
            {copyStatus === "failed" && (
              <div className="space-y-2">
                <p role="alert" className="text-sm">
                  Couldn’t copy. Select the prompt below to copy it manually.
                </p>
                <textarea
                  aria-label="AI setup prompt"
                  readOnly
                  value={aiPrompt}
                  onFocus={(event) => event.currentTarget.select()}
                  className="neo-input min-h-28 w-full rounded-md p-3 text-sm"
                />
              </div>
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor={inputId} className="block text-sm font-bold">
              2. Paste your token
            </label>
            <Input
              id={inputId}
              type="password"
              aria-label="GitHub personal access token"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={
                isConfigured ? "Paste a replacement token" : "github_pat_..."
              }
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              className="neo-input h-11 rounded-md px-3 py-2 text-base placeholder:font-normal placeholder:text-gray-600 dark:placeholder:text-neutral-400"
              required
            />
            <p className="pt-1 text-xs text-neutral-700 dark:text-neutral-300">
              {isConfigured
                ? "Token saved. Paste a new one to replace it."
                : "Saved in this browser for 30 days. Clear it anytime."}
            </p>
          </div>
          <details className="text-xs text-neutral-700 dark:text-neutral-300">
            <summary className="neo-link w-fit cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-offset-4">
              How your data is used
            </summary>
            <p className="mt-2 leading-relaxed">
              Your token is kept in a protected browser cookie for 30 days.
              Repository content is sent to the AI provider to generate your
              diagram. Private diagrams are stored privately on GitDiagram. You
              can also{" "}
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
          {error && (
            <p
              role="alert"
              className="text-sm font-medium text-red-700 dark:text-red-300"
            >
              {ERROR_MESSAGES[error]}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            {isConfigured && (
              <button
                type="button"
                onClick={async () => {
                  if (await clear()) {
                    if (onSaved) {
                      onClose();
                      onSaved();
                    }
                  }
                }}
                disabled={isPending}
                className="neo-link min-h-10 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear token
              </button>
            )}
            <div className="ml-auto flex gap-3">
              <Button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="neo-button-muted min-h-11 px-4 py-2"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pat.trim().length === 0 || isPending}
                className="neo-button min-h-11 px-4 py-2 disabled:opacity-50"
              >
                {isPending
                  ? "Saving..."
                  : repository
                    ? "Save & retry"
                    : "Save token"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
