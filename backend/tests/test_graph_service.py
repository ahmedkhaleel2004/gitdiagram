from app.services.graph_service import (
    DiagramGraph,
    compile_diagram_graph,
)
from app.services.mermaid_service import validate_mermaid_syntax


def test_compile_diagram_graph_uses_mermaid_safe_ids():
    graph = DiagramGraph.model_validate(
        {
            "groups": [{"id": "style", "label": "Style", "description": None}],
            "nodes": [
                {
                    "id": "class",
                    "label": "Class",
                    "type": "service",
                    "description": None,
                    "groupId": "style",
                    "path": "src/class.ts",
                    "shape": None,
                },
                {
                    "id": "end",
                    "label": "End",
                    "type": "worker",
                    "description": None,
                    "groupId": None,
                    "path": None,
                    "shape": None,
                },
            ],
            "edges": [
                {
                    "from": "class",
                    "to": "end",
                    "label": None,
                    "description": None,
                    "style": None,
                }
            ],
        }
    )

    diagram = compile_diagram_graph(graph, "acme", "demo", "main")

    assert 'subgraph group_style["Style"]' in diagram
    assert 'node_class["Class<br/>[class.ts]"]' in diagram
    assert "node_class --> node_end" in diagram
    assert (
        'click node_class "https://github.com/acme/demo/blob/main/src/class.ts"' in diagram
    )

    validation_result = validate_mermaid_syntax(diagram)
    assert validation_result.valid is True
