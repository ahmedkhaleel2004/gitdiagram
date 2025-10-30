"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { FaGithub } from "react-icons/fa";
import { getStarCount } from "~/app/_actions/github";
import { PrivateReposDialog } from "./private-repos-dialog";
import { ApiKeyDialog } from "./api-key-dialog";

export function Header() {
  const [isPrivateReposDialogOpen, setIsPrivateReposDialogOpen] =
    useState(false);
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
  const [starCount, setStarCount] = useState<number | null>(null);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    void getStarCount().then(setStarCount);
  }, []);

  // Initialize theme from localStorage and apply class on <html>
  useEffect(() => {
    if (typeof document === "undefined") return;
    const saved = localStorage.getItem("theme");
    const html = document.documentElement;
    if (saved === "dark") {
      html.classList.remove("light-mode");
      html.classList.add("dark-mode");
      setIsDark(true);
    } else {
      html.classList.remove("dark-mode");
      html.classList.add("light-mode");
      setIsDark(false);
    }
  }, []);

  const toggleTheme = () => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    if (isDark) {
      html.classList.remove("dark-mode");
      html.classList.add("light-mode");
      localStorage.setItem("theme", "light");
      setIsDark(false);
    } else {
      html.classList.remove("light-mode");
      html.classList.add("dark-mode");
      localStorage.setItem("theme", "dark");
      setIsDark(true);
    }
  };

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
    <header className="border-b-[3px] border">
      <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-8">
        <Link href="/" className="flex items-center">
          <span className="text-lg font-semibold sm:text-xl">
            <span className="text-foreground transition-colors duration-200">
              Git
            </span>
            <span className="text-primary transition-opacity duration-200 hover:opacity-80">
              Diagram
            </span>
          </span>
        </Link>
        <nav className="flex items-center gap-3 sm:gap-6">
          <span
            onClick={() => setIsApiKeyDialogOpen(true)}
            className="cursor-pointer text-sm font-medium text-foreground transition-transform hover:translate-y-[-2px] hover:text-primary"
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
            className="cursor-pointer text-sm font-medium text-foreground transition-transform hover:translate-y-[-2px] hover:text-primary"
          >
            <span className="sm:hidden">Private Repos</span>
            <span className="hidden sm:inline">Private Repos</span>
          </span>
          <Link
            href="https://github.com/ahmedkhaleel2004/gitdiagram"
            className="flex items-center gap-1 text-sm font-medium text-foreground transition-transform hover:translate-y-[-2px] hover:text-primary sm:gap-2"
          >
            <FaGithub className="h-5 w-5" />
            <span className="hidden sm:inline">GitHub</span>
          </Link>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            title={isDark ? "Light mode" : "Dark mode"}
            className="flex h-10 w-10 items-center justify-center rounded-full border text-lg transition-colors hover:bg-accent"
          >
            <span>{isDark ? "🌙" : "☀️"}</span>
          </button>
          <span className="flex items-center gap-1 text-sm font-medium text-foreground">
            <span className="text-accent">★</span>
            {formatStarCount(starCount)}
          </span>
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
