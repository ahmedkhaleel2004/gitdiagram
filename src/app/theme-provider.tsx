// src/app/theme-provider.tsx
"use client";
import React, { createContext, useContext, useEffect, useState } from "react";

// Types for theme
export type Theme = "light" | "dark";

interface ThemeContextProps {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextProps | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Only run on client
    const storedTheme = (localStorage.getItem("theme") as Theme) || "light";
    setThemeState(storedTheme);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const root = window.document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme, mounted]);

  const setTheme = (newTheme: Theme) => setThemeState(newTheme);
  const toggleTheme = () => setThemeState((prev) => (prev === "dark" ? "light" : "dark"));

  if (!mounted) return null; // Prevent hydration mismatch

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}
