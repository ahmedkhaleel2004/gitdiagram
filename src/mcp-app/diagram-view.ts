import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import DOMPurify from "dompurify";
import mermaid from "mermaid";

import {
  createHiddenRenderTarget,
  withDomNodesSerializingSafely,
} from "~/components/mermaid-diagram-helpers";
import {
  buildMermaidConfig,
  MERMAID_SVG_SANITIZE_OPTIONS,
} from "~/features/diagram/mermaid-config";
import {
  enforceSafeMermaidLinks,
  sanitizeMermaidSourceForRender,
} from "~/features/diagram/mermaid-security";
import {
  isOpenableUrl,
  readDiagramPayload,
  type DiagramViewPayload,
} from "~/features/mcp-app/diagram-payload";
import { createViewport, type Viewport } from "./viewport";

// The diagram view GitDiagram shows inline in ChatGPT and other MCP Apps
// hosts when get_repository_diagram runs (the ui:// resource in
// src/server/mcp/app.ts loads this bundle, built by scripts/build-mcp-app.mjs).
// It renders the stored Mermaid source with the site's own safety layers:
// source sanitizing, Mermaid's antiscript level with SVG-only labels,
// DOMPurify, then the GitHub-only link allowlist. Links open through the host.

const root = document.getElementById("gitdiagram-view");

const app = new App(
  { name: "GitDiagram diagram view", version: "1.0.0" },
  { availableDisplayModes: ["inline", "fullscreen"] },
);

let payload: DiagramViewPayload | null = null;
let viewport: Viewport | null = null;
let renderedTheme: string | null = null;
let renderCount = 0;
let expandButton: HTMLButtonElement | null = null;
let hint: HTMLParagraphElement | null = null;

const hostContext = (): McpUiHostContext => app.getHostContext() ?? {};
const isDark = () => hostContext().theme === "dark";
const isFullscreen = () => hostContext().displayMode === "fullscreen";
const canFullscreen = () =>
  hostContext().availableDisplayModes?.includes("fullscreen") ?? false;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes))
    node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function openLink(url: string) {
  if (!isOpenableUrl(url)) return;
  void app.openLink({ url }).catch(() => undefined);
}

function showMessage(message: string, action?: { label: string; url: string }) {
  if (!root) return;
  viewport?.destroy();
  viewport = null;
  expandButton = null;
  hint = null;
  const box = element("div", { class: "gd-message" });
  box.append(element("p", {}, message));
  if (action) {
    const button = element(
      "button",
      { type: "button", class: "gd-button gd-primary" },
      action.label,
    );
    button.addEventListener("click", () => openLink(action.url));
    box.append(button);
  }
  root.replaceChildren(box);
}

function button(label: string, title: string, onClick: () => void) {
  const node = element(
    "button",
    { type: "button", class: "gd-button", title, "aria-label": title },
    label,
  );
  node.addEventListener("click", onClick);
  return node;
}

const isTouch = () =>
  hostContext().deviceCapabilities?.touch ??
  window.matchMedia?.("(pointer: coarse)").matches ??
  false;

/** Touch moves the diagram only full screen, so the chat still scrolls. */
function hintText() {
  if (isTouch() && !isFullscreen() && canFullscreen())
    return "Tap Expand to move and zoom. Tap a component to open its code on GitHub.";
  return isTouch()
    ? "Drag to move, pinch to zoom. Tap a component to open its code on GitHub."
    : "Drag to move, pinch or ⌘-scroll to zoom. Click a component to open its code on GitHub.";
}

function applyTheme() {
  const theme = isDark() ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.documentElement.dataset.display = isFullscreen()
    ? "fullscreen"
    : "inline";
  viewport?.setTouchPanning(isFullscreen() || !canFullscreen());
  // Keep clear of what the host draws over the view (notches, its composer).
  const insets = hostContext().safeAreaInsets;
  if (root)
    root.style.padding = insets
      ? `${insets.top}px ${insets.right}px ${insets.bottom}px ${insets.left}px`
      : "";
  if (hint) hint.textContent = hintText();
  if (expandButton) {
    expandButton.textContent = isFullscreen() ? "Close" : "Expand";
    const title = isFullscreen() ? "Back to the chat" : "Open full screen";
    expandButton.title = title;
    expandButton.setAttribute("aria-label", title);
  }
}

async function renderDiagram(current: DiagramViewPayload) {
  if (!root) return;
  if (current.status === "missing" || !current.mermaid) {
    showMessage(
      `GitDiagram has no diagram of ${current.repository} yet. Open it on GitDiagram to make one; it usually takes about a minute.`,
      { label: "Make the diagram on GitDiagram", url: current.diagramUrl },
    );
    return;
  }

  const render = ++renderCount;
  const header = element("header", { class: "gd-bar" });
  const title = element("div", { class: "gd-title" });
  title.append(element("strong", {}, current.repository));
  if (current.stars !== null)
    title.append(
      element(
        "span",
        { class: "gd-stars" },
        `★ ${current.stars.toLocaleString("en-US")}`,
      ),
    );
  const actions = element("div", { class: "gd-actions" });
  actions.append(
    button("−", "Zoom out", () => viewport?.step(-1)),
    button("Fit", "Show the whole diagram", () => viewport?.fit("whole")),
    button("+", "Zoom in", () => viewport?.step(1)),
  );
  expandButton = canFullscreen()
    ? button("Expand", "Open full screen", () => {
        void app
          .requestDisplayMode({
            mode: isFullscreen() ? "inline" : "fullscreen",
          })
          .catch(() => undefined);
      })
    : null;
  if (expandButton) actions.append(expandButton);
  const open = button("Open in GitDiagram", "Open on gitdiagram.com", () =>
    openLink(current.diagramUrl),
  );
  open.classList.add("gd-primary");
  actions.append(open);
  header.append(title, actions);

  const stage = element("div", {
    class: "gd-stage",
    tabindex: "0",
    role: "region",
    "aria-label": `Architecture diagram of ${current.repository}`,
  });
  const canvas = element("div", { class: "gd-canvas" });
  stage.append(canvas);
  const hintLine = element("p", { class: "gd-hint" });

  const theme = isDark() ? "dark" : "light";
  mermaid.initialize(buildMermaidConfig({ isDark: theme === "dark" }));
  const target = createHiddenRenderTarget(Math.max(root.clientWidth, 640));
  try {
    const { svg } = await withDomNodesSerializingSafely(() =>
      mermaid.render(
        `gitdiagram-${render}`,
        sanitizeMermaidSourceForRender(current.mermaid ?? ""),
        target,
      ),
    );
    if (render !== renderCount) return;
    canvas.innerHTML = DOMPurify.sanitize(svg, MERMAID_SVG_SANITIZE_OPTIONS);
    enforceSafeMermaidLinks(canvas);
  } catch {
    if (render !== renderCount) return;
    showMessage(
      `The diagram of ${current.repository} could not be drawn here. It is available on GitDiagram.`,
      { label: "Open in GitDiagram", url: current.diagramUrl },
    );
    return;
  } finally {
    target.remove();
  }

  viewport?.destroy();
  root.replaceChildren(header, stage, hintLine);
  hint = hintLine;
  renderedTheme = theme;
  viewport = createViewport(stage, canvas);
  applyTheme();
  viewport.fit(isFullscreen() ? "readable" : "whole");

  // Components link to their code on GitHub; the host opens them.
  stage.addEventListener(
    "click",
    (event) => {
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      event.preventDefault();
      if (viewport?.consumeDrag()) return;
      const href =
        anchor.getAttribute("href") ?? anchor.getAttribute("xlink:href");
      if (href) openLink(href);
    },
    true,
  );
}

function update() {
  applyTheme();
  if (!payload) return;
  const theme = isDark() ? "dark" : "light";
  if (!viewport || renderedTheme !== theme) void renderDiagram(payload);
  else viewport.fit(isFullscreen() ? "readable" : "whole");
}

app.ontoolresult = (result) => {
  const next = readDiagramPayload(result);
  if (!next) {
    const text = (result.content ?? [])
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n")
      .trim();
    payload = null;
    showMessage(
      text.split("\n")[0] || "GitDiagram could not load this diagram.",
    );
    return;
  }
  payload = next;
  void renderDiagram(next);
};

app.onhostcontextchanged = () => update();

void app
  .connect()
  .then(() => applyTheme())
  .catch(() =>
    showMessage("This diagram view could not connect to the chat app."),
  );
