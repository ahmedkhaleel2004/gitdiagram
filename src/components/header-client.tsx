"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X } from "lucide-react";
import { FaGithub } from "react-icons/fa";

import { storeOpenAiKey } from "~/lib/openai-key";
import { preloadBrowseIndex } from "~/features/browse/index-client";

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
  const router = useRouter();
  const pathname = usePathname();
  const [isPrivateReposDialogOpen, setIsPrivateReposDialogOpen] =
    useState(false);
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const githubRepoUrl = "https://github.com/ahmedkhaleel2004/gitdiagram";
  const isBrowsePage = pathname === "/browse";
  const showMobileGithubButton = pathname === "/" || isBrowsePage;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      router.prefetch("/browse");
      void preloadBrowseIndex();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [router]);

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
          <span className="text-xl font-semibold sm:text-xl">
            <span className="text-black transition-colors duration-200 hover:text-gray-600 dark:text-white dark:hover:text-[hsl(var(--neo-button-hover))]">
              Git
            </span>
            <span className="text-purple-600 transition-colors duration-200 hover:text-purple-500 dark:text-[hsl(var(--neo-button))] dark:hover:text-[hsl(var(--neo-button-hover))]">
              Diagram
            </span>
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:hidden">
          {showMobileGithubButton ? (
            <Link
              href={githubRepoUrl}
              className="browse-muted-button inline-flex min-h-[42px] items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold"
            >
              <FaGithub className="h-4 w-4" />
              <span className="flex items-center gap-1">
                <span className="text-amber-400 dark:text-[hsl(var(--neo-link))]">
                  ★
                </span>
                {starCount !== null ? formatStarCount(starCount) : "GitHub"}
              </span>
            </Link>
          ) : !isBrowsePage ? (
            <Link
              href="/browse"
              className="browse-muted-button inline-flex min-h-[42px] items-center rounded-md px-3 py-2 text-sm font-semibold"
            >
              Browse
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen((currentValue) => !currentValue)}
            aria-expanded={isMobileMenuOpen}
            aria-controls="mobile-site-menu"
            className="browse-muted-button inline-flex min-h-[42px] items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold"
          >
            {isMobileMenuOpen ? (
              <X className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Menu className="h-4 w-4" aria-hidden="true" />
            )}
            Menu
          </button>
        </div>
        <nav className="hidden items-center gap-6 sm:flex">
          <Link
            href="/browse"
            className="text-sm font-medium text-black transition-transform hover:translate-y-[-2px] hover:text-purple-600 dark:text-neutral-200 dark:hover:text-[hsl(var(--neo-link-hover))]"
          >
            Browse
          </Link>
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
            href={githubRepoUrl}
            className="flex items-center gap-1 text-sm font-medium text-black transition-transform hover:translate-y-[-2px] hover:text-purple-600 sm:gap-2 dark:text-neutral-200 dark:hover:text-[hsl(var(--neo-link-hover))]"
          >
            <FaGithub className="h-5 w-5" />
            <span className="hidden sm:inline">GitHub</span>
            {starCount !== null ? (
              <span className="flex items-center gap-1">
                <span className="text-amber-400 dark:text-[hsl(var(--neo-link))]">
                  ★
                </span>
                {formatStarCount(starCount)}
              </span>
            ) : null}
          </Link>
        </nav>

        {isMobileMenuOpen ? (
          <>
            <button
              type="button"
              aria-label="Close mobile menu"
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 z-40 bg-black/30 sm:hidden"
            />
            <div className="pointer-events-none fixed inset-x-4 top-[4.5rem] z-50 sm:hidden">
              <div
                id="mobile-site-menu"
                className="neo-panel pointer-events-auto ml-auto w-full max-w-[18rem] rounded-lg p-3"
              >
                <nav className="flex flex-col gap-2">
                  {!isBrowsePage ? (
                    <Link
                      href="/browse"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="browse-muted-button inline-flex min-h-[48px] items-center justify-between rounded-md px-4 py-3 text-sm font-semibold"
                    >
                      Browse
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setIsApiKeyDialogOpen(true);
                      setIsMobileMenuOpen(false);
                    }}
                    className="browse-muted-button inline-flex min-h-[48px] items-center justify-between rounded-md px-4 py-3 text-sm font-semibold"
                  >
                    API Key
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsPrivateReposDialogOpen(true);
                      setIsMobileMenuOpen(false);
                    }}
                    className="browse-muted-button inline-flex min-h-[48px] items-center justify-between rounded-md px-4 py-3 text-sm font-semibold"
                  >
                    Private Repos
                  </button>
                  <ThemeToggle
                    onToggle={() => setIsMobileMenuOpen(false)}
                    className="browse-muted-button inline-flex min-h-[48px] items-center justify-between rounded-md px-4 py-3 text-sm font-semibold"
                  />
                  <Link
                    href={githubRepoUrl}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="browse-muted-button inline-flex min-h-[48px] items-center justify-between gap-3 rounded-md px-4 py-3 text-sm font-semibold"
                  >
                    <span className="flex items-center gap-2">
                      <FaGithub className="h-5 w-5" />
                      GitHub Repo
                    </span>
                    {starCount !== null ? (
                      <span className="text-xs tracking-[0.12em] text-[hsl(var(--neo-soft-text))] uppercase dark:text-neutral-300">
                        {formatStarCount(starCount)}
                      </span>
                    ) : null}
                  </Link>
                </nav>
              </div>
            </div>
          </>
        ) : null}

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
