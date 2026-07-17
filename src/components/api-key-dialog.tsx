"use client";

import Link from "next/link";

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

interface ApiKeyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}

const ERROR_MESSAGES: Record<Exclude<CredentialSettingError, null>, string> = {
  load: "Could not load the saved-key status.",
  save: "Could not save the API key. Please try again.",
  clear: "Could not clear the API key. Please try again.",
};

export function ApiKeyDialog({ isOpen, onClose, onSaved }: ApiKeyDialogProps) {
  const {
    clear,
    error,
    isConfigured,
    isPending,
    save,
    setValue: setApiKey,
    value: apiKey,
  } = useCredentialSetting({
    credential: "openai_api_key",
    isOpen,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const saved = await save();
    if (!saved) {
      return;
    }

    onClose();
    await onSaved?.();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="neo-panel p-6 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-black dark:text-neutral-100">
            OpenAI API Key
          </DialogTitle>
          <DialogDescription className="sr-only">
            Provide an OpenAI API key to use for diagram generation in this
            browser.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="space-y-4 text-black dark:text-neutral-200"
        >
          <div className="text-sm">
            GitDiagram offers infinite free diagram generations! You can also
            provide your own OpenAI API key to generate diagrams at your own
            cost. A saved key persists for 30 days in a protected HttpOnly
            cookie.
            <br />
            <br />
            <span className="font-medium">Get your OpenAI API key </span>
            <Link
              href="https://platform.openai.com/api-keys"
              className="neo-link font-medium"
            >
              here
            </Link>
            .
          </div>
          <details className="group text-sm [&>summary:focus-visible]:outline-none">
            <summary className="neo-link cursor-pointer font-medium">
              Data storage disclaimer
            </summary>
            <div className="mt-2 space-y-2 overflow-hidden pl-2">
              <p>
                Page JavaScript cannot read the saved key. Your browser sends it
                only to this site&apos;s API routes, where it is used for
                generation. You can also self-host this app by following the
                instructions in the{" "}
                <Link href={GITHUB_REPO_URL} className="neo-link">
                  README
                </Link>
                .
              </p>
            </div>
          </details>
          <Input
            type="password"
            aria-label="OpenAI API key"
            placeholder={isConfigured ? "Enter a replacement key" : "sk-..."}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="neo-input flex-1 rounded-md px-3 py-2 text-base font-bold placeholder:text-base placeholder:font-normal placeholder:text-gray-700 dark:placeholder:text-neutral-400"
            required
          />
          {isConfigured ? (
            <p className="text-sm font-medium">
              An API key is currently saved. Its value cannot be displayed.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm font-medium text-red-700">
              {ERROR_MESSAGES[error]}
            </p>
          ) : null}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => void clear()}
              disabled={!isConfigured || isPending}
              className="neo-link text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear
            </button>
            <div className="flex gap-3">
              <Button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="neo-button-muted px-4 py-2"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={apiKey.trim().length === 0 || isPending}
                className="neo-button px-4 py-2 disabled:opacity-50"
              >
                {isPending ? "Saving..." : "Save Key"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
