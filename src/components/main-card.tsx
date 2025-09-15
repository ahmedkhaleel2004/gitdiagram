"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Sparkles } from "lucide-react";
import React from "react";
import { CustomizationDropdown } from "./customization-dropdown";
import { exampleRepos } from "~/lib/exampleRepos";
import { ExportDropdown } from "./export-dropdown";
import { ChevronUp, ChevronDown } from "lucide-react";
import { Switch } from "~/components/ui/switch";
import { Dropdown } from "./ui/dropdown";
import { getRepoBranches } from "~/lib/fetch-backend";

interface MainCardProps {
  isHome?: boolean;
  username?: string;
  repo?: string;
  branch?: string;
  showCustomization?: boolean;
  onModify?: (instructions: string) => void;
  onRegenerate?: (instructions: string) => void;
  onCopy?: () => void;
  lastGenerated?: Date;
  onExportImage?: () => void;
  zoomingEnabled?: boolean;
  onZoomToggle?: () => void;
  loading?: boolean;
}

export default function MainCard({
  isHome = true,
  username,
  repo,
  branch,
  showCustomization,
  onModify,
  onRegenerate,
  onCopy,
  lastGenerated,
  onExportImage,
  zoomingEnabled,
  onZoomToggle,
  loading,
}: MainCardProps) {
  const [repoUrl, setRepoUrl] = useState("");
  const [debouncedRepoUrl, setDebouncedRepoUrl] = useState("");
  const [error, setError] = useState("");
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [branches, setBranches] = useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [loadingMoreBranches, setLoadingMoreBranches] = useState(false);
  const pageSize = 50;
  const [pagination, setPagination] = useState({
    currentPage: 1,
    hasNext: false,
  });
  const [activeDropdown, setActiveDropdown] = useState<
    "customize" | "export" | null
  >(null);
  const router = useRouter();

  const fetchBranches = useCallback(
    async (page: number) => {
      if (!debouncedRepoUrl) {
        setBranches([]);
        setSelectedBranch("");
        setError("");
        setLoadingBranches(false);
        return;
      }

      const { sanitizedUsername, sanitizedRepo } = verifyRepoUrl(debouncedRepoUrl) ?? {};

      if (!sanitizedUsername || !sanitizedRepo) {
        setError("Invalid repository URL format");
        setLoadingBranches(false);
        return;
      }

      if (page === 1) {
        setLoadingBranches(true);
        setBranches([]);
        setSelectedBranch("");
        setError("");
        setPagination({
          currentPage: 1,
          hasNext: false,
        });
      } else {
        setLoadingMoreBranches(true);
      }

      try {
        const githubPat =
          localStorage.getItem("github_pat") ?? process.env.GITHUB_PAT;
        const branchList = await getRepoBranches(
          sanitizedUsername,
          sanitizedRepo,
          githubPat,
          page,
          pageSize,
        );

        if (branchList.error) {
          setError(branchList.error);
          if (page === 1) {
            setBranches([]);
            setSelectedBranch("");
          }
          return;
        }

        if (page == 1) {
          const branches = branchList.branches ?? [];
          const defaultBranch = branchList.defaultBranch;
          if (defaultBranch && !branches.includes(defaultBranch)) {
            setBranches([defaultBranch, ...branches]);
          } else {
            setBranches(branches);
          }
        } else {
          setBranches((prev) => {
            const newBranches = (branchList.branches ?? []).filter(
              branch => !prev.includes(branch)
            );
            return [...prev, ...newBranches];
          });
        }

        if (branchList.pagination) {
          setPagination({
            currentPage: branchList.pagination.current_page,
            hasNext: branchList.pagination.has_next,
          });
        }

        setSelectedBranch(branch ?? branchList.defaultBranch ?? "");
        setError("");
      } catch (error) {
        setError(error as string);
        if (page === 1) {
          setBranches([]);
          setSelectedBranch("");
        }
      } finally {
        if (page === 1) {
          setLoadingBranches(false);
        } else {
          setLoadingMoreBranches(false);
        }
      }
    },
    [debouncedRepoUrl, branch],
  );

  useEffect(() => {
    void fetchBranches(1);
  }, [fetchBranches]);

  const loadMoreBranches = useCallback(async () => {
    if (!debouncedRepoUrl || !pagination.hasNext || loadingMoreBranches) return;
    await fetchBranches(pagination.currentPage + 1);
  }, [
    debouncedRepoUrl,
    pagination.hasNext,
    pagination.currentPage,
    loadingMoreBranches,
    fetchBranches,
  ]);

  useEffect(() => {
    if (username && repo) {
      setRepoUrl(`https://github.com/${username}/${repo}`);
    }
  }, [username, repo]);

  // Debouncing
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedRepoUrl(repoUrl);
    }, 600);
    return () => clearTimeout(handler);
  }, [repoUrl]);

  useEffect(() => {
    if (loading) {
      setActiveDropdown(null);
    }
  }, [loading]);

  //verify the repoUrl format and extract username and repo
  const verifyRepoUrl = (repoUrl: string) => {
    const githubUrlPattern =
      /^https?:\/\/github\.com\/([a-zA-Z0-9-_]+)\/([a-zA-Z0-9-_\.]+)\/?$/;
    const match = githubUrlPattern.exec(repoUrl.trim());

    if (!match) {
      setError("Please enter a valid GitHub repository URL");
      return;
    }

    const [, username, repo] = match || [];
    if (!username || !repo) {
      setError("Invalid repository URL format");
      return;
    }
    const sanitizedUsername = encodeURIComponent(username);
    const sanitizedRepo = encodeURIComponent(repo);

    return { sanitizedUsername, sanitizedRepo };
  }

  const handleSubmit = (e: React.FormEvent) => {
    if(loadingBranches) {
      setError("Please wait for branches to load");
      return;
    }
    e.preventDefault();
    setError("");

    const { sanitizedUsername, sanitizedRepo } = verifyRepoUrl(repoUrl) ?? {};
    if (!sanitizedUsername || !sanitizedRepo) {
      return; // Error will be set in verifyRepoUrl
    }
      
    const branchQuery = `?branch=${encodeURIComponent(selectedBranch)}`;
    router.push(`/${sanitizedUsername}/${sanitizedRepo}${branchQuery}`);
  };

  const handleExampleClick = (repoPath: string, e: React.MouseEvent) => {
    e.preventDefault();
    router.push(repoPath);
  };

  const handleDropdownToggle = (dropdown: "customize" | "export") => {
    setActiveDropdown(activeDropdown === dropdown ? null : dropdown);
  };

  return (
    <Card className="relative w-full max-w-3xl border-[3px] border-black bg-purple-200 p-4 shadow-[8px_8px_0_0_#000000] sm:p-8">
      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
        <div className="flex flex-row gap-3 sm:flex-row sm:gap-4">
          <Input
            placeholder="https://github.com/username/repo"
            className="flex-1 rounded-md border-[3px] border-black px-3 py-4 text-base font-bold shadow-[4px_4px_0_0_#000000] placeholder:text-base placeholder:font-normal placeholder:text-gray-700 sm:px-4 sm:py-6 sm:text-lg sm:placeholder:text-lg"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-4">
          <Dropdown
            branches={branches}
            selectedBranch={selectedBranch}
            onSelectBranch={setSelectedBranch}
            loadingBranches={loadingBranches}
            loadingMoreBranches={loadingMoreBranches}
            hasMoreBranches={pagination.hasNext}
            onLoadMore={loadMoreBranches}
            setError={setError}
          />
          <Button
            type="submit"
            className="border-[3px] border-black bg-purple-400 p-4 px-4 text-base text-black shadow-[4px_4px_0_0_#000000] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 hover:transform hover:bg-purple-400 sm:p-6 sm:px-6 sm:text-lg"
          >
            Diagram
          </Button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* Dropdowns Container */}
        {!isHome && (
          <div className="space-y-4">
            {/* Only show buttons and dropdowns when not loading */}
            {!loading && (
              <>
                {/* Buttons Container */}
                <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-4">
                  {showCustomization &&
                    onModify &&
                    onRegenerate &&
                    lastGenerated && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          handleDropdownToggle("customize");
                        }}
                        className={`flex items-center justify-between gap-2 rounded-md border-[3px] border-black px-4 py-2 font-medium text-black transition-colors sm:max-w-[250px] ${
                          activeDropdown === "customize"
                            ? "bg-purple-400"
                            : "bg-purple-300 hover:bg-purple-400"
                        }`}
                      >
                        <span>Customize Diagram</span>
                        {activeDropdown === "customize" ? (
                          <ChevronUp size={20} />
                        ) : (
                          <ChevronDown size={20} />
                        )}
                      </button>
                    )}

                  {onCopy && lastGenerated && onExportImage && (
                    <div className="flex flex-col items-center justify-center gap-2">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          handleDropdownToggle("export");
                        }}
                        className={`flex items-center justify-between gap-2 rounded-md border-[3px] border-black px-4 py-2 font-medium text-black transition-colors sm:max-w-[250px] ${
                          activeDropdown === "export"
                            ? "bg-purple-400"
                            : "bg-purple-300 hover:bg-purple-400"
                        }`}
                      >
                        <span>Export Diagram</span>
                        {activeDropdown === "export" ? (
                          <ChevronUp size={20} />
                        ) : (
                          <ChevronDown size={20} />
                        )}
                      </button>
                    </div>
                  )}
                  {lastGenerated && (
                    <>
                      <label className="font-medium text-black">
                        Enable Zoom
                      </label>
                      <Switch
                        checked={zoomingEnabled}
                        onCheckedChange={onZoomToggle}
                      />
                    </>
                  )}
                </div>

                {/* Dropdown Content */}
                <div
                  className={`transition-all duration-200 ${
                    activeDropdown
                      ? "pointer-events-auto max-h-[500px] opacity-100"
                      : "pointer-events-none max-h-0 opacity-0"
                  }`}
                >
                  {activeDropdown === "customize" && (
                    <CustomizationDropdown
                      onModify={onModify!}
                      onRegenerate={onRegenerate!}
                      lastGenerated={lastGenerated!}
                      isOpen={true}
                    />
                  )}
                  {activeDropdown === "export" && (
                    <ExportDropdown
                      onCopy={onCopy!}
                      lastGenerated={lastGenerated!}
                      onExportImage={onExportImage!}
                      isOpen={true}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Example Repositories */}
        {isHome && (
          <div className="space-y-2">
            <div className="text-sm text-gray-700 sm:text-base">
              Try these example repositories:
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(exampleRepos).map(([name, path]) => (
                <Button
                  key={name}
                  variant="outline"
                  className="border-2 border-black bg-purple-400 text-sm text-black transition-transform hover:-translate-y-0.5 hover:transform hover:bg-purple-300 sm:text-base"
                  onClick={(e) => handleExampleClick(path, e)}
                >
                  {name}
                </Button>
              ))}
            </div>
          </div>
        )}
      </form>

      {/* Decorative Sparkle */}
      <div className="absolute -bottom-8 -left-12 hidden sm:block">
        <Sparkles
          className="h-20 w-20 fill-sky-400 text-black"
          strokeWidth={0.6}
          style={{ transform: "rotate(-15deg)" }}
        />
      </div>
    </Card>
  );
}
