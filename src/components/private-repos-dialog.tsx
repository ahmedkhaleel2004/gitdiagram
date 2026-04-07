"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { useState, useEffect } from "react";
import Link from "next/link";

interface PrivateReposDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (pat: string) => void;
}

export function PrivateReposDialog({
  isOpen,
  onClose,
  onSubmit,
}: PrivateReposDialogProps) {
  const [pat, setPat] = useState<string>("");

  useEffect(() => {
    const storedPat = localStorage.getItem("github_pat");
    if (storedPat) {
      setPat(storedPat);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(pat);
    setPat("");
  };

  const handleClear = () => {
    localStorage.removeItem("github_pat");
    setPat("");
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
            Personal Access Token with repo scope. The token will be stored
            locally in your browser. Find out how{" "}
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
            <div className="animate-accordion-down mt-2 space-y-2 overflow-hidden pl-2">
              <p>
                Successful private-repository diagrams are stored in the
                configured private artifact bucket for this deployment. You can
                also self-host this app by following the instructions in the{" "}
                <Link
                  href="https://github.com/ahmedkhaleel2004/gitdiagram"
                  className="neo-link"
                >
                  README
                </Link>
                .
              </p>
            </div>
          </details>
          <Input
            type="password"
            placeholder="ghp_..."
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            className="neo-input flex-1 rounded-md px-3 py-2 text-base font-bold placeholder:text-base placeholder:font-normal placeholder:text-gray-700 dark:placeholder:text-neutral-400"
            required
          />
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleClear}
              className="neo-link text-sm"
            >
              Clear
            </button>
            <div className="flex gap-3">
              <Button
                type="button"
                onClick={onClose}
                className="neo-button-muted px-4 py-2"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!pat.startsWith("ghp_")}
                className="neo-button px-4 py-2 disabled:opacity-50"
              >
                Save Token
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
