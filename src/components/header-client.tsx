"use client";

import { useState } from "react";
import Link from "next/link";
import { FaGithub } from "react-icons/fa";

import { storeOpenAiKey } from "~/lib/openai-key";

import { ApiKeyDialog } from "./api-key-dialog";
import { PrivateReposDialog } from "./private-repos-dialog";
import { ThemeToggle } from "./theme-toggle";

interface HeaderClientProps {
  starCount: number | null;
}

const compactNumberFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatStarCount(count: number) {
  return compactNumberFormatter.format(count).toLowerCase();
}

export function HeaderClient({ starCount }: HeaderClientProps) {
  const [isPrivateReposDialogOpen, setIsPrivateReposDialogOpen] =
    useState(false);
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);

  const handlePrivateReposSubmit = (pat: string) => {
    localStorage.setItem("github_pat", pat);
    setIsPrivateReposDialogOpen(false);
  };

  const handleApiKeySubmit = (apiKey: string) => {
    storeOpenAiKey(apiKey);
    setIsApiKeyDialogOpen(false);
  };

  return (
    <header className="border-b-[3px] border-black dark:border-black">
      <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-8">
        <Link href="/" className="flex items-center">
          <span className="text-lg font-semibold sm:text-xl">
            <span className="text-black transition-colors duration-200 hover:text-gray-600 dark:text-white dark:hover:text-[hsl(var(--neo-button-hover))]">
              Git
            </span>
            <span className="text-purple-600 transition-colors duration-200 hover:text-purple-500 dark:text-[hsl(var(--neo-button))] dark:hover:text-[hsl(var(--neo-button-hover))]">
              Diagram
            </span>
          </span>
        </Link>
        <nav className="flex items-center gap-3 sm:gap-6">
          <button
            type="button"
            onClick={() => setIsApiKeyDialogOpen(true)}
            className="text-sm font-medium text-black transition-transform hover:translate-y-[-2px] hover:text-purple-600 dark:text-neutral-200 dark:hover:text-[hsl(var(--neo-link-hover))]"
          >
            <span className="flex items-center sm:hidden">
              <span>API Key</span>
            </span>
            <span className="hidden items-center gap-1 sm:flex">
              <span>API Key</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setIsPrivateReposDialogOpen(true)}
            className="text-sm font-medium text-black transition-transform hover:translate-y-[-2px] hover:text-purple-600 dark:text-neutral-200 dark:hover:text-[hsl(var(--neo-link-hover))]"
          >
            <span className="sm:hidden">Private Repos</span>
            <span className="hidden sm:inline">Private Repos</span>
          </button>
          <ThemeToggle />
          <Link
            href="https://github.com/ahmedkhaleel2004/gitdiagram"
            className="flex items-center gap-1 text-sm font-medium text-black transition-transform hover:translate-y-[-2px] hover:text-purple-600 dark:text-neutral-200 dark:hover:text-[hsl(var(--neo-link-hover))] sm:gap-2"
          >
            <FaGithub className="h-5 w-5" />
            <span className="hidden sm:inline">GitHub</span>
          </Link>
          {starCount !== null ? (
            <span className="flex items-center gap-1 text-sm font-medium text-black dark:text-neutral-200">
              <span className="text-amber-400 dark:text-[hsl(var(--neo-link))]">
                ★
              </span>
              {formatStarCount(starCount)}
            </span>
          ) : null}
        </nav>

        <PrivateReposDialog
          isOpen={isPrivateReposDialogOpen}
          onClose={() => setIsPrivateReposDialogOpen(false)}
          onSubmit={handlePrivateReposSubmit}
        />
        <ApiKeyDialog
          isOpen={isApiKeyDialogOpen}
          onClose={() => setIsApiKeyDialogOpen(false)}
          onSubmit={handleApiKeySubmit}
        />
      </div>
    </header>
  );
}
