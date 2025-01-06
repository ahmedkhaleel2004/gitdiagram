import os
import argparse
from app.services.openai_service import OpenAIService
from app.prompts import SYSTEM_FIRST_PROMPT, SYSTEM_SECOND_PROMPT, SYSTEM_THIRD_PROMPT, ADDITIONAL_SYSTEM_INSTRUCTIONS_PROMPT
import sys
from cli import build_file_tree, get_readme


def main():
    parser = argparse.ArgumentParser(
        description="Generate Mermaid diagrams from local Git repositories.")
    parser.add_argument("repo_path", help="Path to the local Git repository")
    parser.add_argument(
        "--instructions", help="Instructions for diagram generation", default=None)
    parser.add_argument(
        "--output", help="Output file for the Mermaid diagram", default="diagram.mmd")

    args = parser.parse_args()

    repo_path = args.repo_path
    instructions = args.instructions
    output_file = args.output

    if not os.path.isdir(repo_path):
        print(f"Error: The path '{repo_path}' is not a valid directory.")
        sys.exit(1)

    openai_service = OpenAIService()

    # Build file tree and get README
    file_tree = build_file_tree(repo_path)
    readme = get_readme(repo_path)

    if not file_tree and not readme:
        print("Error: The repository is empty or unreadable.")
        sys.exit(1)

    # Prepare system prompts with instructions if provided
    first_system_prompt = SYSTEM_FIRST_PROMPT
    third_system_prompt = SYSTEM_THIRD_PROMPT
    if instructions:
        first_system_prompt += "\n" + ADDITIONAL_SYSTEM_INSTRUCTIONS_PROMPT
        third_system_prompt += "\n" + ADDITIONAL_SYSTEM_INSTRUCTIONS_PROMPT
    else:
        instructions = ""

    # Call OpenAI API to get explanation
    try:
        explanation = openai_service.call_openai_api(
            system_prompt=first_system_prompt,
            data={
                "file_tree": file_tree,
                "readme": readme,
                "instructions": instructions
            },
        )
    except Exception as e:
        print(f"Error generating explanation: {e}")
        sys.exit(1)

    if "BAD_INSTRUCTIONS" in explanation:
        print("Error: Invalid or unclear instructions provided.")
        sys.exit(1)

    # Call API to get component mapping
    try:
        full_second_response = openai_service.call_openai_api(
            system_prompt=SYSTEM_SECOND_PROMPT,
            data={
                "explanation": explanation,
                "file_tree": file_tree
            }
        )
    except Exception as e:
        print(f"Error generating component mapping: {e}")
        sys.exit(1)

    # Extract component mapping from the response
    start_tag = "<component_mapping>"
    end_tag = "</component_mapping>"
    try:
        component_mapping_text = full_second_response[
            full_second_response.find(start_tag):
            full_second_response.find(end_tag) + len(end_tag)
        ]
    except Exception:
        print("Error extracting component mapping.")
        sys.exit(1)

    # Call API to get Mermaid diagram
    try:
        mermaid_code = openai_service.call_openai_api(
            system_prompt=third_system_prompt,
            data={
                "explanation": explanation,
                "component_mapping": component_mapping_text,
                "instructions": instructions
            }
        )
    except Exception as e:
        print(f"Error generating Mermaid diagram: {e}")
        sys.exit(1)

    if "BAD_INSTRUCTIONS" in mermaid_code:
        print("Error: Invalid or unclear instructions provided.")
        sys.exit(1)

    # Save the diagram to the output file
    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(mermaid_code)
        print(f"Mermaid diagram generated and saved to '{output_file}'.")
    except Exception as e:
        print(f"Error saving diagram: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
