import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DiagramGraph } from "~/features/diagram/graph";
import { connectionRows, evidenceUrl } from "./connection-rows";
import { DiagramConnections } from "./diagram-connections";
import { GenerationActivity } from "./generation-activity";

afterEach(cleanup);

const node = (id: string, label: string, path: string | null) => ({
  id,
  label,
  type: "component",
  description: null,
  groupId: null,
  path,
  shape: null,
});

const graph: DiagramGraph = {
  groups: [],
  nodes: [
    node("sip", "SIP bridge", "SipBridge.cs"),
    node("voice", "Voice agent", "SipVoiceAgent.cs"),
    node("office", "OfficeManager", "OfficeManager/index.html"),
  ],
  edges: [
    {
      from: "sip",
      to: "voice",
      label: "routes calls",
      description: null,
      style: null,
      evidencePath: "SipBridge.cs",
    },
    // A graph stored before citations existed has no evidencePath at all.
    {
      from: "voice",
      to: "office",
      label: null,
      description: null,
      style: "dashed",
    },
  ],
};

describe("connection rows", () => {
  it("names both ends, keeps order and reads missing evidence as none", () => {
    expect(connectionRows(graph)).toEqual([
      {
        key: "0:sip:voice",
        from: "SIP bridge",
        to: "Voice agent",
        label: "routes calls",
        evidencePath: "SipBridge.cs",
        dashed: false,
      },
      {
        key: "1:voice:office",
        from: "Voice agent",
        to: "OfficeManager",
        label: null,
        evidencePath: null,
        dashed: true,
      },
    ]);
  });

  it("links evidence on GitHub only, with every segment encoded", () => {
    expect(
      evidenceUrl("Graphene-Lab/AgentBridge", "docs/sip entry/a#b.cfg"),
    ).toBe(
      "https://github.com/Graphene-Lab/AgentBridge/blob/HEAD/docs/sip%20entry/a%23b.cfg",
    );
    expect(evidenceUrl("owner/repo", "../../evil/x.ts")).toBe(
      "https://github.com/owner/repo/blob/HEAD/evil/x.ts",
    );
    expect(evidenceUrl("owner/repo", "//evil.com")).toBe(
      "https://github.com/owner/repo/blob/HEAD/evil.com",
    );
    expect(evidenceUrl("owner", "a.ts")).toBeNull();
  });
});

describe("connections list", () => {
  it("stays closed until asked, then shows each arrow with its evidence", () => {
    render(
      <DiagramConnections
        graph={graph}
        repository="Graphene-Lab/AgentBridge"
      />,
    );
    const toggle = screen.getByRole("button", { name: /Connections/ });
    expect(toggle).toHaveTextContent("1/2 with evidence");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent(
      "SIP bridge → Voice agent: routes calls — evidence: SipBridge.cs",
    );
    expect(screen.getByRole("link", { name: "SipBridge.cs" })).toHaveAttribute(
      "href",
      "https://github.com/Graphene-Lab/AgentBridge/blob/HEAD/SipBridge.cs",
    );
    expect(items[1]).toHaveTextContent(
      "Voice agent → OfficeManager (dashed) — no file cited; inferred",
    );
  });

  it("appears in the Info panel only for a finished diagram with a repository", () => {
    const { rerender } = render(
      <GenerationActivity
        state={{ status: "complete", graph }}
        repository="owner/repo"
      />,
    );
    expect(screen.getByRole("button", { name: /Connections/ })).toBeVisible();
    rerender(<GenerationActivity state={{ status: "complete", graph }} />);
    expect(
      screen.queryByRole("button", { name: /Connections/ }),
    ).not.toBeInTheDocument();
    rerender(
      <GenerationActivity
        state={{ status: "graph", graph }}
        repository="owner/repo"
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Connections/ }),
    ).not.toBeInTheDocument();
  });

  it("says an older diagram's connections were never checked instead of calling them inferred", () => {
    const legacy: DiagramGraph = {
      ...graph,
      edges: graph.edges.map(({ evidencePath: _unused, ...edge }) => edge),
    };
    render(<DiagramConnections graph={legacy} repository="owner/repo" />);
    const toggle = screen.getByRole("button", { name: /Connections/ });
    expect(toggle).toHaveTextContent("2, not checked");
    fireEvent.click(toggle);
    expect(screen.getByText(/made before GitDiagram checked/)).toBeVisible();
    expect(screen.queryByText(/inferred/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders nothing for a graph without edges", () => {
    const { container } = render(
      <DiagramConnections
        graph={{ ...graph, edges: [] }}
        repository="owner/repo"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
