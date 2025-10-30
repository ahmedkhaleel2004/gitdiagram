"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { useState, useEffect } from "react";
import Link from "next/link";

interface ApiKeyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (apiKey: string) => void;
}

export function ApiKeyDialog({ isOpen, onClose, onSubmit }: ApiKeyDialogProps) {
  const [apiKey, setApiKey] = useState<string>("");

  useEffect(() => {
    const storedKey = localStorage.getItem("openai_key");
    if (storedKey) {
      setApiKey(storedKey);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(apiKey);
    setApiKey("");
  };

  const handleClear = () => {
    localStorage.removeItem("openai_key");
    setApiKey("");
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="border-[3px] border bg-card p-6 shadow-[8px_8px_0_0_#000000] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-foreground">
            Enter OpenAI API Key
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="text-sm">
            GitDiagram offers infinite free diagram generations! You can also
            provide an OpenAI API key to generate diagrams at your own cost. The
            key will be stored locally in your browser.
            {/* GitDiagram offers one free diagram generation. For additional
            diagrams, you&apos;ll need to provide an OpenAI API key. The key
            will be stored locally in your browser. */}
            <br />
            <br />
            <span className="font-medium">Get your OpenAI API key </span>
            <Link
              href="https://platform.openai.com/api-keys"
              className="font-medium text-primary transition-opacity duration-200 hover:opacity-80"
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
                Your API key will be stored locally in your browser and used
                only for generating diagrams. You can also self-host this app by
                following the instructions in the{" "}
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
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
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
                disabled={!apiKey.startsWith("sk-")}
                className="border-[3px] border bg-primary px-4 py-2 text-primary-foreground shadow-[4px_4px_0_0_#000000] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 hover:opacity-90 disabled:opacity-50"
              >
                Save Key
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
