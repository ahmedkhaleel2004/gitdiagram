"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Sparkles } from "lucide-react";
import React from "react";
import { exampleRepos, isExampleRepo } from "~/lib/exampleRepos";
import { ExportDropdown } from "./export-dropdown";
import { ChevronDown } from "lucide-react";
import { Switch } from "~/components/ui/switch";
import { parseGitHubRepoUrl } from "~/features/diagram/github-url";
import { SponsorSlot } from "~/components/sponsor-slot";

interface MainCardProps {
  isHome?: boolean;
  username?: string;
  repo?: string;
  hasDiagram?: boolean;
  onCopy?: () => void;
  lastGenerated?: Date;
  actualCost?: string;
  onExportImage?: () => void;
  onRegenerate?: () => void;
  zoomingEnabled?: boolean;
  onZoomToggle?: () => void;
  loading?: boolean;
}

export default function MainCard({
  isHome = true,
  username,
  repo,
  hasDiagram = false,
  onCopy,
  lastGenerated,
  actualCost,
  onExportImage,
  onRegenerate,
  zoomingEnabled,
  onZoomToggle,
  loading,
}: MainCardProps) {
  const [repoUrl, setRepoUrl] = useState("");
  const [error, setError] = useState("");
  const [activeDropdown, setActiveDropdown] = useState<"export" | null>(null);
  const router = useRouter();
  const isExampleRepoSelected =
    !isHome && !!username && !!repo && isExampleRepo(username, repo);

  useEffect(() => {
    if (username && repo) {
      setRepoUrl(`https://github.com/${username}/${repo}`);
    }
  }, [username, repo]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const parsed = parseGitHubRepoUrl(repoUrl);
    if (!parsed) {
      setError("Please enter a valid GitHub repository URL or owner/repo");
      return;
    }

    const { username, repo } = parsed;
    const sanitizedUsername = encodeURIComponent(username);
    const sanitizedRepo = encodeURIComponent(repo);
    router.push(`/${sanitizedUsername}/${sanitizedRepo}`);
  };

  const handleExampleClick = (repoPath: string, e: React.MouseEvent) => {
    e.preventDefault();
    router.push(repoPath);
  };

  const handleDropdownToggle = (dropdown: "export") => {
    setActiveDropdown(activeDropdown === dropdown ? null : dropdown);
  };

  return (
    <Card className="neo-panel relative w-full max-w-3xl !bg-[hsl(var(--neo-panel))] p-4 sm:p-8">
      <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
          <Input
            placeholder="owner/repo or GitHub URL"
            className="neo-input min-w-0 flex-1 rounded-md px-3 py-4 text-base font-bold placeholder:text-base placeholder:font-normal placeholder:text-gray-700 sm:px-4 sm:py-6 sm:text-lg sm:placeholder:text-lg dark:placeholder:text-neutral-400"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            required
          />
          <Button
            type="submit"
            className="neo-button p-4 px-4 text-base sm:p-6 sm:px-6 sm:text-lg"
          >
            Diagram
          </Button>
        </div>

        {error ? (
          <p className="status-message text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        {/* Dropdowns Container */}
        {!isHome && (
          <div className="space-y-4">
            {/* Only show buttons and dropdowns when not loading */}
            {!loading && (
              <>
                {/* Buttons Container */}
                <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-4">
                  {onRegenerate && (
                    <button
                      type="button"
                      disabled={isExampleRepoSelected}
                      title={
                        isExampleRepoSelected
                          ? "Regeneration is disabled for example repositories."
                          : undefined
                      }
                      className={`flex items-center justify-between gap-2 rounded-md border-[3px] border-black px-4 py-2 font-medium text-black transition-[background-color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.97] motion-reduce:active:scale-100 motion-reduce:active:opacity-80 sm:max-w-[250px] dark:text-black ${
                        isExampleRepoSelected
                          ? "cursor-not-allowed bg-purple-200 opacity-70 dark:bg-[#251b3a] dark:text-[hsl(var(--foreground))]"
                          : "bg-purple-300 hover:bg-purple-400 dark:border-[#2d1d4e] dark:bg-[hsl(var(--neo-subtle-muted))] dark:hover:bg-[hsl(var(--neo-subtle))]"
                      }`}
                      onClick={(e) => {
                        e.preventDefault();
                        setActiveDropdown(null);
                        if (isExampleRepoSelected) return;
                        onRegenerate();
                      }}
                    >
                      Regenerate Diagram
                    </button>
                  )}
                  {hasDiagram && onCopy && onExportImage && (
                    <div className="flex flex-col items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          handleDropdownToggle("export");
                        }}
                        aria-expanded={activeDropdown === "export"}
                        className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border-[3px] border-black px-4 py-2 font-medium text-black transition-[background-color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.97] motion-reduce:active:scale-100 motion-reduce:active:opacity-80 sm:max-w-[250px] dark:text-black ${
                          activeDropdown === "export"
                            ? "bg-purple-400 dark:border-[#2d1d4e] dark:bg-[hsl(var(--neo-button))]"
                            : "bg-purple-300 hover:bg-purple-400 dark:border-[#2d1d4e] dark:bg-[hsl(var(--neo-subtle-muted))] dark:hover:bg-[hsl(var(--neo-button-hover))]"
                        }`}
                      >
                        <span>Export Diagram</span>
                        <ChevronDown
                          size={20}
                          aria-hidden="true"
                          className={`transition-transform duration-150 ease-[var(--ease-in-out)] motion-reduce:rotate-0 ${
                            activeDropdown === "export" ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                    </div>
                  )}
                  {hasDiagram && (
                    <>
                      <label
                        htmlFor="zoom-toggle"
                        className="font-medium text-black dark:text-neutral-100"
                      >
                        Enable Zoom
                      </label>
                      <Switch
                        id="zoom-toggle"
                        checked={zoomingEnabled}
                        onCheckedChange={onZoomToggle}
                      />
                    </>
                  )}
                </div>

                {/* Dropdown Content */}
                {activeDropdown === "export" ? (
                  <div className="export-panel">
                    <ExportDropdown
                      onCopy={onCopy!}
                      lastGenerated={lastGenerated}
                      actualCost={actualCost}
                      onExportImage={onExportImage!}
                    />
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}

        {/* Example Repositories */}
        {isHome && (
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="text-sm font-medium text-gray-700 sm:text-base dark:text-neutral-300">
                Try these example repositories:
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(exampleRepos).map(([name, path]) => (
                  <Button
                    key={name}
                    type="button"
                    variant="outline"
                    className="border-2 border-black bg-purple-400 text-sm text-black hover:bg-purple-300 sm:text-base dark:border-black dark:bg-[hsl(var(--neo-panel-muted))] dark:text-[hsl(var(--foreground))] dark:hover:bg-[hsl(var(--neo-button))] dark:hover:text-[#0d0a19]"
                    onClick={(e) => handleExampleClick(path, e)}
                  >
                    {name}
                  </Button>
                ))}
              </div>
            </div>
            <SponsorSlot surface="home" />
          </div>
        )}
      </form>

      {/* Decorative Sparkle */}
      <div className="absolute -bottom-8 -left-12 hidden sm:block">
        <Sparkles
          className="h-20 w-20 fill-sky-400 text-black dark:fill-[hsl(var(--neo-button))] dark:text-[hsl(var(--background))]"
          strokeWidth={0.6}
          style={{ transform: "rotate(-15deg)" }}
        />
      </div>
    </Card>
  );
}
