"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
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
      <DialogContent className="border-[3px] border bg-card p-6 shadow-[8px_8px_0_0_#000000] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-foreground">
            Enter GitHub Personal Access Token
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="text-sm">
            To enable private repositories, you&apos;ll need to provide a GitHub
            Personal Access Token with repo scope. The token will be stored
            locally in your browser. Find out how{" "}
            <Link
              href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens"
              className="text-primary transition-opacity duration-200 hover:opacity-80"
            >
              here
            </Link>
            .
          </div>
          <details className="group text-sm [&>summary:focus-visible]:outline-none">
            <summary className="cursor-pointer font-medium text-primary hover:opacity-80">
              Data storage disclaimer
            </summary>
            <div className="animate-accordion-down mt-2 space-y-2 overflow-hidden pl-2">
              <p>
                Take note that the diagram data will be stored in my database
                (not that I would use it for anything anyways). You can also
                self-host this app by following the instructions in the{" "}
                <Link
                  href="https://github.com/ahmedkhaleel2004/gitdiagram"
                  className="text-primary transition-opacity duration-200 hover:opacity-80"
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
            className="flex-1 rounded-md border-[3px] border px-3 py-2 text-base font-bold text-foreground shadow-[4px_4px_0_0_#000000] placeholder:text-base placeholder:font-normal placeholder:text-muted-foreground"
            required
          />
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleClear}
              className="text-sm text-primary hover:opacity-80"
            >
              Clear
            </button>
            <div className="flex gap-3">
              <Button
                type="button"
                onClick={onClose}
                className="border-[3px] border bg-secondary px-4 py-2 text-foreground shadow-[4px_4px_0_0_#000000] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 hover:opacity-90"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!pat.startsWith("ghp_")}
                className="border-[3px] border bg-primary px-4 py-2 text-primary-foreground shadow-[4px_4px_0_0_#000000] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 hover:opacity-90 disabled:opacity-50"
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
