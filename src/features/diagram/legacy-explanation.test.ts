import { describe, expect, it } from "vitest";
import {
  cleanLegacyExplanation,
  storedExplanationText,
} from "./legacy-explanation";

// Shortened from real stored explanations (englishm/moq-js, piwigo/piwigo,
// inp-net/churros): the old pipeline's guide for whoever drew the diagram.
const OLD_GUIDE = `<explanation>
Based on the provided file tree and README, I'll explain how to create a system design diagram for this Media over QUIC project.

1. Project Type & Purpose
- Piwigo is a monolithic, full-stack PHP web application: an open-source photo-gallery platform.

2. Key Components to Include in the Diagram:
a) Transport Layer (from lib/transport/):
- Show Publisher and Subscriber components
- Include Control Flow handling
- Use different colors for each layer

\`\`\`
Infrastructure
├── PostgreSQL Database
└── Redis Cache
\`\`\`

3. Color Coding:
- Transport components in blue
- Media components in green

4. Example Mermaid Diagram Snippet
\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

By following these guidelines, you'll produce a clear, accurate diagram.
</explanation>`;

describe("cleanLegacyExplanation", () => {
  it("keeps the facts of an old drawing guide and drops the instructions", () => {
    const cleaned = cleanLegacyExplanation(OLD_GUIDE);
    expect(cleaned).toBe(
      [
        "### Project Type & Purpose",
        "- Piwigo is a monolithic, full-stack PHP web application: an open-source photo-gallery platform.",
        "",
        "### Key Components",
        "a) Transport Layer (from lib/transport/):",
        "- Publisher and Subscriber components",
        "- Control Flow handling",
        "",
        "**Infrastructure**",
        "- PostgreSQL Database",
        "- Redis Cache",
      ].join("\n"),
    );
    expect(cleaned).not.toMatch(/explanation>|diagram|colou?r|you'll|mermaid/i);
  });

  it("leaves current explanations exactly as they are", () => {
    const current = [
      "## Overview",
      "Roast Room turns a business decision into a scored verdict. The diagram view colors each seat.",
      "- `skills/roast.md` drives the council",
    ].join("\n");
    expect(cleanLegacyExplanation(current)).toBe(current);
    expect(storedExplanationText(current)).toBe(current);
  });

  it("shows nothing rather than a guide with no facts left", () => {
    const onlyAdvice = `<explanation>
Here's how to structure the system design diagram:
1. Diagramming Guidelines
- Use clear labels on each box
- Draw arrows for data flow
2. Visual Details
- Keep it readable
By following these steps, you will produce a great diagram.
</explanation>`;
    expect(cleanLegacyExplanation(onlyAdvice)).toBe("");
  });

  it("also reads the oldest, HTML-escaped tags", () => {
    expect(
      storedExplanationText(
        `&lt;explanation&gt;\n1. Purpose\n- ${"A command-line Unicode block browser written in Go. ".repeat(4)}\n&lt;/explanation&gt;`,
      ),
    ).toMatch(/^### Purpose\n- A command-line Unicode block browser/);
  });
});
