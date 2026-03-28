"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

import {
  clearStoredOpenAiKey,
  getStoredOpenAiKey,
} from "~/lib/openai-key";

import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

interface ApiKeyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (apiKey: string) => void;
}

export function ApiKeyDialog({ isOpen, onClose, onSubmit }: ApiKeyDialogProps) {
  const [apiKey, setApiKey] = useState<string>("");

  useEffect(() => {
    const storedKey = getStoredOpenAiKey();
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
    clearStoredOpenAiKey();
    setApiKey("");
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="neo-panel p-6 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-black dark:text-neutral-100">
            Enter API Key
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="space-y-4 text-black dark:text-neutral-200"
        >
          <div className="text-sm">
            GitDiagram offers infinite free diagram generations! You can also
            provide your own OpenAI API key to generate diagrams at your own cost.
            The key is stored locally in your browser.
            <br />
            <br />
            <span className="font-medium">Get your OpenAI API key </span>
            <Link
              href="https://platform.openai.com/api-keys"
              className="neo-link font-medium"
            >
              here
            </Link>
            .
          </div>
          <details className="group text-sm [&>summary:focus-visible]:outline-none">
            <summary className="neo-link cursor-pointer font-medium">
              Data storage disclaimer
            </summary>
            <div className="animate-accordion-down mt-2 space-y-2 overflow-hidden pl-2">
              <p>
                Your API key will be stored locally in your browser and used
                only for generating diagrams. You can also self-host this app by
                following the instructions in the{" "}
                <Link
                  href="https://github.com/ahmedkhaleel2004/gitdiagram"
                  className="neo-link"
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
            className="neo-input flex-1 rounded-md px-3 py-2 text-base font-bold placeholder:text-base placeholder:font-normal placeholder:text-gray-700 dark:placeholder:text-neutral-400"
            required
          />
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleClear}
              className="neo-link text-sm"
            >
              Clear
            </button>
            <div className="flex gap-3">
              <Button
                type="button"
                onClick={onClose}
                className="neo-button-muted px-4 py-2"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={apiKey.trim().length === 0}
                className="neo-button px-4 py-2 disabled:opacity-50"
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
