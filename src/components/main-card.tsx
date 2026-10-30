"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { exampleRepos } from "~/lib/exampleRepos";
import {
  COMMIT_SHA_INVALID_ERROR,
  MAX_COMMIT_INPUT_LENGTH,
  parseCommitSha,
} from "~/features/diagram/commit";
import { parseGitHubRepoUrl } from "~/features/diagram/github-url";
import { SponsorSlot } from "~/components/sponsor-slot";
import {
  clearRecentDiagrams,
  useRecentDiagrams,
} from "~/features/recent/recent-diagrams";
import { captureAnalyticsEvent } from "~/lib/analytics-client";

const CHIP_CLASS =
  "h-9 border-2 border-black bg-purple-400 px-3 text-sm font-semibold text-black hover:bg-purple-300 sm:h-10 sm:px-4 sm:text-base sm:font-medium dark:border-black dark:bg-[hsl(var(--neo-panel-muted))] dark:text-[hsl(var(--foreground))] dark:hover:bg-[hsl(var(--neo-button))] dark:hover:text-[#0d0a19]";

/**
 * The home page's repository form, with example repositories and, once this
 * browser has opened some, its recent public diagrams.
 */
export default function MainCard({ sponsor = true }: { sponsor?: boolean }) {
  const [repoUrl, setRepoUrl] = useState("");
  const [commit, setCommit] = useState("");
  const recent = useRecentDiagrams();
  const [error, setError] = useState("");
  const [commitError, setCommitError] = useState("");
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCommitError("");

    const parsed = parseGitHubRepoUrl(repoUrl);
    if (!parsed) {
      setError("Please enter a valid GitHub repository URL or owner/repo");
      return;
    }

    const { username, repo } = parsed;
    const sanitizedUsername = encodeURIComponent(username);
    const sanitizedRepo = encodeURIComponent(repo);

    // The Commit field wins over a commit in a pasted GitHub commit URL
    // (github.com/owner/repo/commit/sha).
    const typedCommit = commit.trim() || parsed.commit;
    if (typedCommit !== undefined) {
      const parsedCommit = parseCommitSha(typedCommit);
      if (!parsedCommit) {
        setCommitError(COMMIT_SHA_INVALID_ERROR);
        return;
      }
      router.push(
        `/${sanitizedUsername}/${sanitizedRepo}/commit/${parsedCommit.sha}`,
      );
      return;
    }

    router.push(`/${sanitizedUsername}/${sanitizedRepo}`);
  };

  const handleExampleClick = (repoPath: string, e: React.MouseEvent) => {
    e.preventDefault();
    router.push(repoPath);
  };

  return (
    <div className="neo-panel home-main-card relative w-full max-w-3xl rounded-lg !bg-[hsl(var(--neo-panel))] sm:p-8">
      <form onSubmit={handleSubmit} className="space-y-3.5 sm:space-y-6">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2.5 sm:flex sm:gap-4">
          <label htmlFor="repository-input" className="sr-only">
            GitHub repository
          </label>
          <Input
            id="repository-input"
            placeholder="owner/repo or GitHub URL"
            className="neo-input h-14 min-w-0 flex-1 rounded-md px-4 py-0 text-base font-bold placeholder:text-base placeholder:font-normal placeholder:text-gray-700 max-sm:col-start-1 max-sm:row-start-1 sm:h-10 sm:px-4 sm:py-6 sm:text-lg sm:placeholder:text-lg dark:placeholder:text-neutral-400"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            aria-describedby={error ? "repository-input-error" : undefined}
            aria-invalid={Boolean(error)}
            required
          />
          <label htmlFor="commit-input" className="sr-only">
            Commit (optional)
          </label>
          <Input
            id="commit-input"
            placeholder="Commit (optional)"
            className="neo-input h-14 min-w-0 rounded-md px-4 py-0 font-mono text-base font-bold placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:text-gray-700 max-sm:col-span-2 max-sm:row-start-2 sm:h-10 sm:w-44 sm:shrink-0 sm:px-4 sm:py-6 sm:text-lg sm:placeholder:text-lg dark:placeholder:text-neutral-400"
            value={commit}
            onChange={(e) => setCommit(e.target.value)}
            maxLength={MAX_COMMIT_INPUT_LENGTH}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby={commitError ? "commit-input-error" : undefined}
            aria-invalid={Boolean(commitError)}
          />
          <Button
            type="submit"
            className="neo-button size-14 shrink-0 p-0 text-base max-sm:col-start-2 max-sm:row-start-1 sm:h-10 sm:w-auto sm:p-6 sm:px-6 sm:text-lg [&_svg]:size-6"
          >
            <ArrowRight
              className="sm:hidden"
              strokeWidth={2.75}
              aria-hidden="true"
            />
            <span className="max-sm:sr-only">Diagram</span>
          </Button>
        </div>

        {error ? (
          <p
            id="repository-input-error"
            className="status-message text-sm text-red-600"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {commitError ? (
          <p
            id="commit-input-error"
            className="status-message text-sm text-red-600"
            role="alert"
          >
            {commitError}
          </p>
        ) : null}

        <div className="space-y-4">
          <div className="flex items-center gap-2.5 sm:block sm:space-y-3">
            <div className="shrink-0 text-sm font-medium text-gray-700 sm:text-base dark:text-neutral-300">
              <span className="sm:hidden">Try:</span>
              <span className="hidden sm:inline">
                Try these example repositories:
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(exampleRepos).map(([name, path]) => (
                <Button
                  key={name}
                  type="button"
                  variant="outline"
                  className={`${CHIP_CLASS} ${
                    name === "GitDiagram" ? "hidden sm:inline-flex" : ""
                  }`}
                  onClick={(e) => handleExampleClick(path, e)}
                >
                  {name}
                </Button>
              ))}
            </div>
          </div>
          {recent.length > 0 && (
            <div className="flex items-center gap-2.5 sm:block sm:space-y-3">
              <div className="shrink-0 text-sm font-medium text-gray-700 sm:text-base dark:text-neutral-300">
                <span className="sm:hidden">Recent:</span>
                <span className="hidden sm:inline">Your recent diagrams:</span>
              </div>
              <div className="flex min-w-0 gap-2">
                {recent.slice(0, 4).map((entry, index) => (
                  <Button
                    key={`${entry.owner}/${entry.repo}`}
                    type="button"
                    variant="outline"
                    title={`${entry.owner}/${entry.repo}`}
                    aria-label={`${entry.owner}/${entry.repo}`}
                    // One line: two on phones, four on wider screens, long names cut short.
                    className={`${CHIP_CLASS} max-w-[6.5rem] min-w-0 sm:max-w-[9rem] ${index >= 2 ? "hidden sm:inline-flex" : ""}`}
                    onClick={() => {
                      captureAnalyticsEvent("recent_diagram_clicked", {
                        repository: `${entry.owner}/${entry.repo}`,
                        position: index,
                      });
                      router.push(`/${entry.owner}/${entry.repo}`);
                    }}
                  >
                    <span className="truncate">{entry.repo}</span>
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  title="Clear recent diagrams"
                  aria-label="Clear recent diagrams"
                  className="size-9 shrink-0 border-2 border-black bg-transparent p-0 text-black hover:bg-purple-300 sm:size-10 dark:border-black dark:bg-transparent dark:text-[hsl(var(--foreground))] dark:hover:bg-[hsl(var(--neo-panel-muted))]"
                  onClick={clearRecentDiagrams}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
          {sponsor && (
            <SponsorSlot
              surface="home"
              className="max-[389px]:mt-7 max-sm:mt-10"
            />
          )}
        </div>
      </form>

      <div className="absolute -bottom-8 -left-12 hidden sm:block">
        <Sparkles
          className="h-20 w-20 fill-sky-400 text-black dark:fill-[hsl(var(--neo-button))] dark:text-[hsl(var(--background))]"
          strokeWidth={0.6}
          style={{ transform: "rotate(-15deg)" }}
        />
      </div>
    </div>
  );
}
