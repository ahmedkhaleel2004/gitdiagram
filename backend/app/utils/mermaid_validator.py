import mermaid

def validate_mermaid_syntax(mermaid_code: str) -> bool:
    """
    Validates the syntax of the given Mermaid.js code.

    Args:
        mermaid_code (str): The Mermaid.js code to validate.

    Returns:
        bool: True if the syntax is valid, False otherwise.
    """
    try:
        # Parse the Mermaid.js code to check for syntax errors
        mermaid.parse(mermaid_code)
        return True
    except mermaid.MermaidError:
        return False
