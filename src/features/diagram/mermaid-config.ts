import type { MermaidConfig } from "mermaid";

// How GitDiagram renders Mermaid, shared by the site's diagram viewer
// (src/components/mermaid-diagram.tsx) and the diagram view shown inside AI
// chat apps (src/mcp-app/), so a diagram looks the same everywhere.

export function buildMermaidConfig({
  isDark,
  backgroundColor,
}: {
  isDark: boolean;
  backgroundColor?: string;
}) {
  return {
    startOnLoad: false,
    suppressErrorRendering: true,
    securityLevel: "antiscript" as const,
    secure: ["securityLevel", "startOnLoad", "maxTextSize"],
    theme: "base" as const,
    // Pure SVG labels survive strict sanitization without relying on
    // foreignObject HTML, which is both harder to secure and less portable.
    htmlLabels: false,
    layout: "elk",
    // Mermaid 12 defaults to the "neo" look and a 120px wrap, which splits
    // file paths mid-name; keep the classic look and the old 200px wrap.
    look: "classic" as const,
    flowchart: {
      wrappingWidth: 200,
      curve: "linear" as const,
      nodeSpacing: 50,
      rankSpacing: 50,
      padding: 15,
    },
    themeVariables: isDark
      ? {
          background: backgroundColor ?? "#1f2631",
          primaryColor: "#2c3544",
          primaryBorderColor: "#6dd4e9",
          primaryTextColor: "#e8edf5",
          lineColor: "#ffd486",
          secondaryColor: "#26303f",
          tertiaryColor: "#323d4d",
        }
      : {
          background: backgroundColor ?? "#ffffff",
          primaryColor: "#f7f7f7",
          primaryBorderColor: "#000000",
          primaryTextColor: "#171717",
          lineColor: "#000000",
          secondaryColor: "#f0f0f0",
          tertiaryColor: "#f7f7f7",
        },
    themeCSS: `
        .clickable > * {
          scale: 1;
          transform-box: fill-box;
          transform-origin: center;
          transition: scale 160ms cubic-bezier(0.23, 1, 0.32, 1);
        }
        .clickable {
          cursor: pointer;
        }
        @media (hover: hover) and (pointer: fine) {
          .clickable:hover > * {
            scale: 1.05;
            filter: brightness(0.85);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .clickable > * {
            transition: none;
          }
          .clickable:hover > * {
            scale: 1;
          }
        }
      `,
  } satisfies MermaidConfig;
}

/** DOMPurify options for a rendered diagram SVG. */
export const MERMAID_SVG_SANITIZE_OPTIONS = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  FORBID_TAGS: ["script"],
};
