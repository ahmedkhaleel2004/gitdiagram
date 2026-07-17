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

interface PrivateReposDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const ERROR_MESSAGES: Record<Exclude<CredentialSettingError, null>, string> = {
  load: "Could not load the saved-token status.",
  save: "Could not save the GitHub token. Please try again.",
  clear: "Could not clear the GitHub token. Please try again.",
};

export function PrivateReposDialog({
  isOpen,
  onClose,
}: PrivateReposDialogProps) {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const saved = await save();
    if (saved) {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="neo-panel p-6 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-black dark:text-neutral-100">
            Enter GitHub Personal Access Token
          </DialogTitle>
          <DialogDescription className="sr-only">
            Provide a GitHub personal access token to enable private repository
            diagrams in this browser.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="space-y-4 text-black dark:text-neutral-200"
        >
          <div className="text-sm">
            To enable private repositories, you&apos;ll need to provide a GitHub
            Personal Access Token with repository access. A saved token persists
            for 30 days in a protected HttpOnly cookie. Find out how{" "}
            <Link
              href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens"
              className="neo-link"
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
                Page JavaScript cannot read the saved token. Your browser sends
                it only to this site&apos;s API routes. Successful
                private-repository diagrams are stored in the configured private
                artifact bucket for this deployment. You can also self-host this
                app by following the instructions in the{" "}
                <Link href={GITHUB_REPO_URL} className="neo-link">
                  README
                </Link>
                .
              </p>
            </div>
          </details>
          <Input
            type="password"
            aria-label="GitHub personal access token"
            placeholder={
              isConfigured ? "Enter a replacement token" : "github_pat_..."
            }
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            className="neo-input flex-1 rounded-md px-3 py-2 text-base font-bold placeholder:text-base placeholder:font-normal placeholder:text-gray-700 dark:placeholder:text-neutral-400"
            required
          />
          {isConfigured ? (
            <p className="text-sm font-medium">
              A GitHub token is currently saved. Its value cannot be displayed.
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
                disabled={pat.trim().length === 0 || isPending}
                className="neo-button px-4 py-2 disabled:opacity-50"
              >
                {isPending ? "Saving..." : "Save Token"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
