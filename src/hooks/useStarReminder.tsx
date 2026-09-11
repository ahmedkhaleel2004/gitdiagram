"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { GITHUB_REPO_URL } from "~/lib/site";

export function useStarReminder() {
  useEffect(() => {
    const hasShownStarReminder = localStorage.getItem("hasShownStarReminder");

    if (!hasShownStarReminder) {
      const timeoutId = setTimeout(() => {
        toast("Enjoying GitDiagram?", {
          className: "star-reminder-toast",
          action: {
            label: "Star ★",
            onClick: () => window.open(GITHUB_REPO_URL, "_blank"),
          },
          duration: 5000,
          dismissible: true,
        });

        localStorage.setItem("hasShownStarReminder", "true");
      }, 5000);

      return () => clearTimeout(timeoutId);
    }
  }, []);
}
