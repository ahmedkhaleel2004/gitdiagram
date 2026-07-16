"use client";

import { Suspense, use, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { GitHubIcon } from "~/components/icons/github-icon";
import { storeOpenAiKey } from "~/lib/openai-key";

import { ThemeToggle } from "./theme-toggle";

const loadApiKeyDialog = () =>
  import("./api-key-dialog").then((module) => module.ApiKeyDialog);
const loadPrivateReposDialog = () =>
  import("./private-repos-dialog").then((module) => module.PrivateReposDialog);

const ApiKeyDialog = dynamic(loadApiKeyDialog, { ssr: false });
const PrivateReposDialog = dynamic(loadPrivateReposDialog, { ssr: false });

interface HeaderClientProps {
  starCount: Promise<number | null>;
}

const compactNumberFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatStarCount(count: number) {
  return compactNumberFormatter.format(count).toLowerCase();
}

function MobileStarCount({ starCount }: HeaderClientProps) {
  const count = use(starCount);
  return count !== null ? formatStarCount(count) : "GitHub";
}

function DesktopStarCount({ starCount }: HeaderClientProps) {
  const count = use(starCount);
  if (count === null) return null;

  return (
    <span className="flex items-center gap-1">
      <span className="text-amber-400 dark:text-[hsl(var(--neo-link))]">★</span>
      {formatStarCount(count)}
    </span>
  );
}

function MobileMenuStarCount({ starCount }: HeaderClientProps) {
  const count = use(starCount);
  if (count === null) return null;

  return (
    <span className="text-xs tracking-[0.12em] text-[hsl(var(--neo-soft-text))] uppercase dark:text-neutral-300">
      {formatStarCount(count)}
    </span>
  );
}

export function HeaderClient({ starCount }: HeaderClientProps) {
  const pathname = usePathname();
  const [isPrivateReposDialogOpen, setIsPrivateReposDialogOpen] =
    useState(false);
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const githubRepoUrl = "https://github.com/ahmedkhaleel2004/gitdiagram";
  const isBrowsePage = pathname === "/browse";
  const showMobileGithubButton = pathname === "/" || isBrowsePage;

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
              <GitHubIcon className="h-4 w-4" />
              <span className="flex items-center gap-1">
                <span className="text-amber-400 dark:text-[hsl(var(--neo-link))]">
                  ★
                </span>
                <Suspense fallback="GitHub">
                  <MobileStarCount starCount={starCount} />
                </Suspense>
              </span>
            </Link>
          ) : !isBrowsePage ? (
            <Link
              href="/browse"
              prefetch={false}
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
            className="text-sm font-medium text-black transition-colors duration-150 hover:text-purple-600 dark:text-neutral-200 dark:hover:text-[hsl(var(--neo-link-hover))]"
          >
            Browse
          </Link>
          <button
            type="button"
            onFocus={() => void loadApiKeyDialog()}
            onPointerEnter={() => void loadApiKeyDialog()}
            onClick={() => setIsApiKeyDialogOpen(true)}
            className="text-sm font-medium text-black transition-colors duration-150 hover:text-purple-600 dark:text-neutral-200 dark:hover:text-[hsl(var(--neo-link-hover))]"
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
            onFocus={() => void loadPrivateReposDialog()}
            onPointerEnter={() => void loadPrivateReposDialog()}
            onClick={() => setIsPrivateReposDialogOpen(true)}
            className="text-sm font-medium text-black transition-colors duration-150 hover:text-purple-600 dark:text-neutral-200 dark:hover:text-[hsl(var(--neo-link-hover))]"
          >
            <span className="sm:hidden">Private Repos</span>
            <span className="hidden sm:inline">Private Repos</span>
          </button>
          <ThemeToggle />
          <Link
            href={githubRepoUrl}
            className="flex items-center gap-1 text-sm font-medium text-black transition-colors duration-150 hover:text-purple-600 sm:gap-2 dark:text-neutral-200 dark:hover:text-[hsl(var(--neo-link-hover))]"
          >
            <GitHubIcon className="h-5 w-5" />
            <span className="hidden sm:inline">GitHub</span>
            <Suspense fallback={null}>
              <DesktopStarCount starCount={starCount} />
            </Suspense>
          </Link>
        </nav>

        <div
          data-state={isMobileMenuOpen ? "open" : "closed"}
          aria-hidden={!isMobileMenuOpen}
          className="mobile-menu-layer fixed inset-0 z-40 sm:hidden"
        >
          <button
            type="button"
            aria-label="Close mobile menu"
            tabIndex={isMobileMenuOpen ? 0 : -1}
            onClick={() => setIsMobileMenuOpen(false)}
            className="mobile-menu-overlay absolute inset-0 bg-black/30"
          />
          <div className="pointer-events-none absolute inset-x-4 top-[4.5rem] z-10">
            <div
              id="mobile-site-menu"
              inert={!isMobileMenuOpen}
              className="neo-panel mobile-menu-panel pointer-events-auto ml-auto w-full max-w-[18rem] rounded-lg p-3"
            >
              <nav className="flex flex-col gap-2">
                {!isBrowsePage ? (
                  <Link
                    href="/browse"
                    prefetch={false}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="browse-muted-button inline-flex min-h-[48px] items-center justify-between rounded-md px-4 py-3 text-sm font-semibold"
                  >
                    Browse
                  </Link>
                ) : null}
                <button
                  type="button"
                  onFocus={() => void loadApiKeyDialog()}
                  onPointerEnter={() => void loadApiKeyDialog()}
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
                  onFocus={() => void loadPrivateReposDialog()}
                  onPointerEnter={() => void loadPrivateReposDialog()}
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
                    <GitHubIcon className="h-5 w-5" />
                    GitHub Repo
                  </span>
                  <Suspense fallback={null}>
                    <MobileMenuStarCount starCount={starCount} />
                  </Suspense>
                </Link>
              </nav>
            </div>
          </div>
        </div>

        {isPrivateReposDialogOpen ? (
          <PrivateReposDialog
            isOpen
            onClose={() => setIsPrivateReposDialogOpen(false)}
            onSubmit={handlePrivateReposSubmit}
          />
        ) : null}
        {isApiKeyDialogOpen ? (
          <ApiKeyDialog
            isOpen
            onClose={() => setIsApiKeyDialogOpen(false)}
            onSubmit={handleApiKeySubmit}
          />
        ) : null}
      </div>
    </header>
  );
}
