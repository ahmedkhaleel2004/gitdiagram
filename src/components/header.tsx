"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { FaGithub } from "react-icons/fa";
import { getStarCount } from "~/app/_actions/github";
import { PrivateReposDialog } from "./private-repos-dialog";
import { ApiKeyDialog } from "./api-key-dialog";
import { ThemeToggleButton } from "./theme-toggle-button";

export function Header() {
  const [isPrivateReposDialogOpen, setIsPrivateReposDialogOpen] =
    useState(false);
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
  const [starCount, setStarCount] = useState<number | null>(null);

  useEffect(() => {
    void getStarCount().then(setStarCount);
  }, []);

  const formatStarCount = (count: number | null) => {
    if (!count) return "10.0k";
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return count.toString();
  };

  const handlePrivateReposSubmit = (pat: string) => {
    // Store the PAT in localStorage
    localStorage.setItem("github_pat", pat);
    setIsPrivateReposDialogOpen(false);
  };

  const handleApiKeySubmit = (apiKey: string) => {
    localStorage.setItem("openai_key", apiKey);
    setIsApiKeyDialogOpen(false);
  };

  return (
    <header className="border-b-[3px] border-black">
      <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-8">
        <Link href="/" className="flex items-center">
          <span className="text-lg font-semibold sm:text-xl">
            <span className= "transition-colors duration-200 hover:text-gray-600">
              Git
            </span>
            <span className="dark:text-[hsl(var(--text-color-primary))] text-purple-500 transition-colors duration-200 hover:text-purple-500">
              Diagram
            </span>
          </span>
        </Link>
        <nav className="flex items-center gap-3 sm:gap-6">
          <span
            onClick={() => setIsApiKeyDialogOpen(true)}
            className="cursor-pointer text-sm font-medium transition-transform hover:translate-y-[-2px] hover:text-purple-600 dark:hover:text-purple-400"
          >
            <span className="flex items-center sm:hidden">
              <span>API Key</span>
            </span>
            <span className="hidden items-center gap-1 sm:flex">
              <span>API Key</span>
            </span>
          </span>
          <span
            onClick={() => setIsPrivateReposDialogOpen(true)}
            className="cursor-pointer text-sm font-medium transition-transform hover:translate-y-[-2px] hover:text-purple-600 dark:hover:text-purple-400"
          >
            <span className="sm:hidden">Private Repos</span>
            <span className="hidden sm:inline">Private Repos</span>
          </span>
          <Link
            href="https://github.com/ahmedkhaleel2004/gitdiagram"
            className="flex items-center gap-1 text-sm font-medium transition-transform hover:translate-y-[-2px] hover:text-purple-600 dark:hover:text-purple-400 sm:gap-2"
          >
            <FaGithub className="h-5 w-5" />
            <span className="hidden sm:inline">GitHub</span>
          </Link>
          <span className="flex items-center gap-1 text-sm font-medium">
            <span className="text-amber-400">★</span>
            {formatStarCount(starCount)}
          </span>
          <ThemeToggleButton />
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
