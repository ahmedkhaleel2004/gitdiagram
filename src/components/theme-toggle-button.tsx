import React from "react";
import { useTheme } from "~/app/theme-provider";
import { FaMoon, FaSun } from "react-icons/fa";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";

export function ThemeToggleButton() {
  const { theme, toggleTheme } = useTheme();

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label="Toggle dark mode"
            onClick={toggleTheme}
            title={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            className="ml-2 flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-accent"
          >
            {theme === "dark" ? (
              <FaSun className="h-5 w-5 text-yellow-400" />
            ) : (
              <FaMoon className="h-5 w-5 text-gray-700" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
