import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DIAGRAM_META_KEY } from "~/features/mcp-app/diagram-payload";

// The view runs in a chat app's sandboxed frame. These tests drive it the way
// a host does (a tool result, then clicks) with Mermaid and the host bridge
// replaced, and check the safety layers between the two.

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  initialize: vi.fn(),
  openLink: vi.fn(async () => ({})),
  requestDisplayMode: vi.fn(async () => ({ mode: "fullscreen" })),
  hostContext: {
    theme: "light",
    availableDisplayModes: ["inline", "fullscreen"],
  } as Record<string, unknown>,
  app: null as null | { ontoolresult?: (result: unknown) => void },
}));

vi.mock("mermaid", () => ({
  default: { initialize: mocks.initialize, render: mocks.render },
}));

vi.mock("@modelcontextprotocol/ext-apps", () => ({
  App: class {
    ontoolresult?: (result: unknown) => void;
    onhostcontextchanged?: () => void;
    constructor() {
      mocks.app = this;
    }
    getHostContext() {
      return mocks.hostContext;
    }
    openLink = mocks.openLink;
    requestDisplayMode = mocks.requestDisplayMode;
    connect() {
      return Promise.resolve();
    }
  },
}));

const PAYLOAD = {
  status: "found",
  repository: "fastapi/fastapi",
  diagramUrl: "https://gitdiagram.com/fastapi/fastapi",
  githubUrl: "https://github.com/fastapi/fastapi",
  stars: 102536,
  mermaid:
    'flowchart TD\n  a["App"]\n  click a "https://github.com/fastapi/fastapi/blob/master/fastapi/applications.py"',
};

const SVG = `<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">
  <script>window.pwned = true</script>
  <a href="https://github.com/fastapi/fastapi/blob/master/fastapi/applications.py"><g class="node"><rect width="80" height="40"/><text>App</text></g></a>
  <a href="https://evil.example/steal"><text>Bad</text></a>
  <g onclick="window.pwned = true"><text>Handler</text></g>
</svg>`;

const view = () => document.getElementById("gitdiagram-view")!;

async function showResult(result: unknown) {
  mocks.app?.ontoolresult?.(result);
  await vi.waitFor(() =>
    expect(view().querySelector(".gd-bar, .gd-message")).not.toBeNull(),
  );
}

beforeAll(async () => {
  document.body.innerHTML = '<main id="gitdiagram-view"></main>';
  await import("./diagram-view");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.render.mockResolvedValue({ svg: SVG });
  view().replaceChildren();
});

describe("the diagram view", () => {
  it("renders a sanitized diagram whose links are GitHub-only", async () => {
    await showResult({ content: [], _meta: { [DIAGRAM_META_KEY]: PAYLOAD } });

    expect(mocks.render).toHaveBeenCalledWith(
      expect.stringMatching(/^gitdiagram-\d+$/),
      PAYLOAD.mermaid,
      expect.any(HTMLElement),
    );
    expect(view().textContent).toContain("fastapi/fastapi");
    expect(view().textContent).toContain("★ 102,536");
    const canvas = view().querySelector(".gd-canvas")!;
    expect(canvas.querySelector("script")).toBeNull();
    expect(canvas.innerHTML).not.toContain("onclick");
    const hrefs = Array.from(canvas.querySelectorAll("a"), (anchor) =>
      anchor.getAttribute("href"),
    );
    expect(hrefs).toEqual([
      "https://github.com/fastapi/fastapi/blob/master/fastapi/applications.py",
      null,
    ]);
    expect((window as { pwned?: boolean }).pwned).toBeUndefined();
  });

  it("drops unsafe click directives before Mermaid sees them", async () => {
    await showResult({
      content: [],
      _meta: {
        [DIAGRAM_META_KEY]: {
          ...PAYLOAD,
          mermaid: 'flowchart TD\n  a["App"]\n  click a "javascript:alert(1)"',
        },
      },
    });
    expect(mocks.render.mock.calls[0]?.[1]).not.toContain("javascript:");
  });

  it("opens component links through the host, never in the frame", async () => {
    await showResult({ content: [], _meta: { [DIAGRAM_META_KEY]: PAYLOAD } });
    const [good, bad] = view().querySelectorAll(".gd-canvas a");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    good!.querySelector("text")!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(mocks.openLink).toHaveBeenCalledWith({
      url: "https://github.com/fastapi/fastapi/blob/master/fastapi/applications.py",
    });
    bad!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(mocks.openLink).toHaveBeenCalledTimes(1);
  });

  it("opens the diagram on GitDiagram and asks for full screen", async () => {
    await showResult({ content: [], _meta: { [DIAGRAM_META_KEY]: PAYLOAD } });
    const buttons = Array.from(view().querySelectorAll("button"));
    buttons
      .find((button) => button.textContent === "Open in GitDiagram")!
      .click();
    expect(mocks.openLink).toHaveBeenCalledWith({
      url: "https://gitdiagram.com/fastapi/fastapi",
    });
    buttons.find((button) => button.textContent === "Expand")!.click();
    expect(mocks.requestDisplayMode).toHaveBeenCalledWith({
      mode: "fullscreen",
    });
  });

  it("offers to make a diagram that does not exist yet", async () => {
    await showResult({
      content: [],
      _meta: {
        [DIAGRAM_META_KEY]: { ...PAYLOAD, status: "missing", mermaid: null },
      },
    });
    expect(mocks.render).not.toHaveBeenCalled();
    expect(view().textContent).toContain("no diagram of fastapi/fastapi yet");
    view().querySelector("button")!.click();
    expect(mocks.openLink).toHaveBeenCalledWith({
      url: "https://gitdiagram.com/fastapi/fastapi",
    });
  });

  it("shows the tool's own message when there is no diagram to draw", async () => {
    await showResult({
      content: [{ type: "text", text: "Too many GitDiagram requests.\nMore." }],
      isError: true,
    });
    expect(view().textContent).toBe("Too many GitDiagram requests.");
  });

  it("falls back to a link when Mermaid cannot draw the diagram", async () => {
    mocks.render.mockRejectedValue(new Error("Parse error"));
    await showResult({ content: [], _meta: { [DIAGRAM_META_KEY]: PAYLOAD } });
    expect(view().textContent).toContain("could not be drawn here");
  });
});
