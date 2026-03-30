"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { cn } from "~/lib/utils";

interface ThemeToggleProps {
  className?: string;
  onToggle?: () => void;
}

export function ThemeToggle({ className, onToggle }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const baseClassName =
    "text-sm font-medium text-black transition-transform hover:translate-y-[-2px] hover:text-purple-600 dark:text-neutral-200 dark:hover:text-[hsl(var(--neo-link-hover))]";

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button type="button" className={cn(baseClassName, className)}>
        Dark
      </button>
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => {
        setTheme(isDark ? "light" : "dark");
        onToggle?.();
      }}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(baseClassName, className)}
    >
      {isDark ? "Light" : "Dark"}
    </button>
  );
}
