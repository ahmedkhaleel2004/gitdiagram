from app.routers.generate import process_click_events


def test_process_click_events_builds_blob_and_tree_links():
    diagram = 'flowchart TD\nclick Api "src/api.ts"\nclick Core "src/core"'
    output = process_click_events(diagram, "u", "r", "main")

    assert 'click Api "https://github.com/u/r/blob/main/src/api.ts"' in output
    assert 'click Core "https://github.com/u/r/tree/main/src/core"' in output
