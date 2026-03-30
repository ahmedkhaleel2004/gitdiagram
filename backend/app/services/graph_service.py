from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

MAX_GRAPH_ATTEMPTS = 3
MAX_GRAPH_GROUPS = 10
MAX_GRAPH_NODES = 34
MAX_GRAPH_EDGES = 48
TONE_CLASS_NAMES = (
    "toneBlue",
    "toneAmber",
    "toneMint",
    "toneRose",
    "toneIndigo",
    "toneTeal",
)
GENERIC_NODE_TYPES = {
    "app",
    "application",
    "component",
    "directory",
    "folder",
    "library",
    "module",
    "package",
    "project",
    "repo",
    "repository",
    "service",
    "system",
    "utility",
}
MAX_NODE_FILE_HINT_LENGTH = 18


class DiagramGraphGroup(BaseModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    label: str = Field(min_length=1, max_length=72)
    description: str | None = Field(max_length=240)


class DiagramGraphNode(BaseModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    label: str = Field(min_length=1, max_length=72)
    type: str = Field(min_length=1, max_length=72)
    description: str | None = Field(max_length=240)
    groupId: str | None = Field(pattern=r"^[a-z][a-z0-9_]*$")
    path: str | None = Field(min_length=1, max_length=512)
    shape: Literal["box", "database", "queue", "document", "circle", "hexagon"] | None


class DiagramGraphEdge(BaseModel):
    from_: str = Field(alias="from", pattern=r"^[a-z][a-z0-9_]*$")
    to: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    label: str | None = Field(min_length=1, max_length=72)
    description: str | None = Field(max_length=240)
    style: Literal["solid", "dashed"] | None

    model_config = {"populate_by_name": True}


class DiagramGraph(BaseModel):
    groups: list[DiagramGraphGroup] = Field(max_length=MAX_GRAPH_GROUPS)
    nodes: list[DiagramGraphNode] = Field(min_length=1, max_length=MAX_GRAPH_NODES)
    edges: list[DiagramGraphEdge] = Field(max_length=MAX_GRAPH_EDGES)


class GraphValidationIssue(BaseModel):
    path: str
    message: str


def build_file_tree_lookup(file_tree: str) -> set[str]:
    return {entry.strip() for entry in file_tree.splitlines() if entry.strip()}


def validate_diagram_graph(graph: DiagramGraph, file_tree_lookup: set[str]) -> list[GraphValidationIssue]:
    issues: list[GraphValidationIssue] = []
    group_ids: set[str] = set()
    node_ids: set[str] = set()

    for index, group in enumerate(graph.groups):
        if group.id in group_ids:
            issues.append(
                GraphValidationIssue(
                    path=f"groups.{index}.id",
                    message=f'Duplicate group id "{group.id}".',
                )
            )
        group_ids.add(group.id)

    for index, node in enumerate(graph.nodes):
        if node.id in node_ids:
            issues.append(
                GraphValidationIssue(
                    path=f"nodes.{index}.id",
                    message=f'Duplicate node id "{node.id}".',
                )
            )
        node_ids.add(node.id)

        if node.groupId and node.groupId not in group_ids:
            issues.append(
                GraphValidationIssue(
                    path=f"nodes.{index}.groupId",
                    message=f'Unknown group id "{node.groupId}" for node "{node.id}".',
                )
            )

        if node.path and node.path not in file_tree_lookup:
            issues.append(
                GraphValidationIssue(
                    path=f"nodes.{index}.path",
                    message=f'Path "{node.path}" does not exist in the repository file tree.',
                )
            )

    for index, edge in enumerate(graph.edges):
        if edge.from_ not in node_ids:
            issues.append(
                GraphValidationIssue(
                    path=f"edges.{index}.from",
                    message=f'Unknown source node id "{edge.from_}".',
                )
            )
        if edge.to not in node_ids:
            issues.append(
                GraphValidationIssue(
                    path=f"edges.{index}.to",
                    message=f'Unknown target node id "{edge.to}".',
                )
            )

    return issues


def format_graph_validation_feedback(issues: list[GraphValidationIssue]) -> str:
    return "\n".join(f"{issue.path}: {issue.message}" for issue in issues)


def _escape_mermaid_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').strip()


def _node_label(node: DiagramGraphNode) -> str:
    primary_label = _escape_mermaid_text(node.label)
    secondary_detail = _detail_for_node(node)
    file_hint = _file_hint_for_node(node)
    return "<br/>".join(
        detail for detail in (primary_label, secondary_detail, file_hint) if detail
    )


def _mermaid_node_id(node_id: str) -> str:
    return f"node_{node_id}"


def _mermaid_group_id(group_id: str) -> str:
    return f"group_{group_id}"


def _detail_for_node(node: DiagramGraphNode) -> str | None:
    node_type = node.type.strip()
    if not node_type:
        return None

    normalized_type = node_type.lower()
    normalized_label = node.label.strip().lower()
    if (
        normalized_type in GENERIC_NODE_TYPES
        or normalized_type == normalized_label
        or normalized_type in normalized_label
        or normalized_label in normalized_type
        or len(node_type.split()) > 4
    ):
        return None

    return _escape_mermaid_text(node_type)


def _file_hint_for_node(node: DiagramGraphNode) -> str | None:
    path = (node.path or "").strip()
    if not path or path.endswith("/") or "." not in path:
        return None

    file_name = path.split("/")[-1].strip()
    if not file_name or len(file_name) > MAX_NODE_FILE_HINT_LENGTH:
        return None

    return f"[{_escape_mermaid_text(file_name)}]"


def _render_node(node: DiagramGraphNode) -> str:
    label = _node_label(node)
    shape = node.shape or "box"
    node_id = _mermaid_node_id(node.id)
    if shape == "database":
        return f'{node_id}[("{label}")]'
    if shape == "circle":
        return f'{node_id}(("{label}"))'
    if shape == "hexagon":
        return f'{node_id}{{{{"{label}"}}}}'
    return f'{node_id}["{label}"]'


def _render_edge(edge: DiagramGraphEdge) -> str:
    connector = "-.->" if edge.style == "dashed" else "-->"
    from_id = _mermaid_node_id(edge.from_)
    to_id = _mermaid_node_id(edge.to)
    if edge.label:
        return f'{from_id} {connector}|"{_escape_mermaid_text(edge.label)}"| {to_id}'
    return f"{from_id} {connector} {to_id}"


def _tone_class(group_id: str | None, group_order: dict[str, int]) -> str:
    if not group_id:
        return "toneNeutral"

    index = group_order.get(group_id)
    if index is None:
        return "toneNeutral"

    return TONE_CLASS_NAMES[index % len(TONE_CLASS_NAMES)]


def _build_github_url(path: str, username: str, repo: str, branch: str) -> str:
    is_file = "." in path and not path.endswith("/")
    path_type = "blob" if is_file else "tree"
    return f"https://github.com/{username}/{repo}/{path_type}/{branch}/{path}"


def compile_diagram_graph(graph: DiagramGraph, username: str, repo: str, branch: str) -> str:
    lines: list[str] = ["flowchart TD"]
    grouped_node_ids: set[str] = set()
    class_assignments: dict[str, list[str]] = {}
    group_order = {group.id: index for index, group in enumerate(graph.groups)}

    def push_node(node: DiagramGraphNode, indent: str = ""):
        lines.append(f"{indent}{_render_node(node)}")
        class_name = _tone_class(node.groupId, group_order)
        class_assignments.setdefault(class_name, []).append(node.id)

    for group in graph.groups:
        lines.append("")
        lines.append(
            f'subgraph {_mermaid_group_id(group.id)}["{_escape_mermaid_text(group.label)}"]'
        )
        for node in [candidate for candidate in graph.nodes if candidate.groupId == group.id]:
            push_node(node, "  ")
            grouped_node_ids.add(node.id)
        lines.append("end")

    ungrouped_nodes = [node for node in graph.nodes if node.id not in grouped_node_ids]
    if ungrouped_nodes:
        lines.append("")
        for node in ungrouped_nodes:
            push_node(node)

    if graph.edges:
        lines.append("")
        for edge in graph.edges:
            lines.append(_render_edge(edge))

    nodes_with_paths = [node for node in graph.nodes if node.path]
    if nodes_with_paths:
        lines.append("")
        for node in nodes_with_paths:
            lines.append(
                f'click {_mermaid_node_id(node.id)} "{_build_github_url(node.path or "", username, repo, branch)}"'
            )

    lines.append("")
    lines.append('classDef toneNeutral fill:#f8fafc,stroke:#334155,stroke-width:1.5px,color:#0f172a')
    lines.append('classDef toneBlue fill:#dbeafe,stroke:#2563eb,stroke-width:1.5px,color:#172554')
    lines.append('classDef toneAmber fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f')
    lines.append('classDef toneMint fill:#dcfce7,stroke:#16a34a,stroke-width:1.5px,color:#14532d')
    lines.append('classDef toneRose fill:#ffe4e6,stroke:#e11d48,stroke-width:1.5px,color:#881337')
    lines.append('classDef toneIndigo fill:#e0e7ff,stroke:#4f46e5,stroke-width:1.5px,color:#312e81')
    lines.append('classDef toneTeal fill:#ccfbf1,stroke:#0f766e,stroke-width:1.5px,color:#134e4a')

    for class_name, node_ids in class_assignments.items():
        if node_ids:
            lines.append(f'class {",".join(_mermaid_node_id(node_id) for node_id in node_ids)} {class_name}')

    return "\n".join(lines).strip()
