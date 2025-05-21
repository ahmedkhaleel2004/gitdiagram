# backend/app/utils/diagram_generator_util.py
import asyncio
import json
from functools import lru_cache

from app.services.github_service import GitHubService
from app.services.o4_mini_openai_service import OpenAIo4Service # Your primary LLM service
from app.prompts import (
    SYSTEM_FIRST_PROMPT,
    SYSTEM_SECOND_PROMPT,
    SYSTEM_THIRD_PROMPT,
    ADDITIONAL_SYSTEM_INSTRUCTIONS_PROMPT,
)

# Using the existing lru_cache from generate.py might be tricky if it's module-level.
# For simplicity in this util, we can re-fetch or you can adapt your caching.
# This simplified version fetches directly.
def get_repo_data_for_diagram(username: str, repo: str, github_pat: str | None = None, branch_name: str | None = None):
    current_github_service = GitHubService(pat=github_pat)
    
    actual_branch = branch_name or current_github_service.get_default_branch(username, repo)
    if not actual_branch:
        actual_branch = "main" # fallback
        
    print(f"Util: Fetching data for {username}/{repo} on branch {actual_branch}")
    file_tree = current_github_service.get_github_file_paths_as_list(username, repo) # Implicitly uses default branch per your GitHubService
    readme_content = current_github_service.get_github_readme(username, repo) # Implicitly uses default branch
    
    # If you modify GitHubService to accept a branch for get_github_file_paths_as_list and get_github_readme,
    # you would pass 'actual_branch' to them here. For now, it uses the default logic.
    
    return {"default_branch": actual_branch, "file_tree": file_tree, "readme": readme_content}

async def generate_mermaid_code_for_repo(
    username: str,
    repo_name: str,
    github_pat_for_reading_repo: str | None = None,
    llm_api_key: str | None = None,
    custom_instructions: str = "",
    target_branch_for_analysis: str | None = None # New: specify branch for analysis
) -> tuple[str | None, str | None, str | None]: # Returns (mermaid_code, error_message, analyzed_branch_name)
    o4_service = OpenAIo4Service()

    try:
        # Use target_branch_for_analysis if provided, else default logic (which usually gets default branch)
        repo_data = get_repo_data_for_diagram(username, repo_name, github_pat_for_reading_repo, target_branch_for_analysis)
        file_tree = repo_data["file_tree"]
        readme = repo_data["readme"]
        analyzed_branch = repo_data["default_branch"] # This is the branch data was fetched from

        combined_content = f"{file_tree}\n{readme}"
        token_count = o4_service.count_tokens(combined_content)
        if token_count > 195000:
            return None, f"Repository content (branch: {analyzed_branch}) is too large (>195k tokens).", analyzed_branch

        first_system_prompt = SYSTEM_FIRST_PROMPT
        third_system_prompt = SYSTEM_THIRD_PROMPT
        if custom_instructions:
            first_system_prompt += f"\n{ADDITIONAL_SYSTEM_INSTRUCTIONS_PROMPT}"
            third_system_prompt += f"\n{ADDITIONAL_SYSTEM_INSTRUCTIONS_PROMPT}"

        explanation_parts = []
        async for chunk in o4_service.call_o4_api_stream(
            system_prompt=first_system_prompt,
            data={"file_tree": file_tree, "readme": readme, "instructions": custom_instructions},
            api_key=llm_api_key, reasoning_effort="medium",
        ):
            explanation_parts.append(chunk)
        explanation = "".join(explanation_parts)
        if "BAD_INSTRUCTIONS" in explanation and custom_instructions:
            return None, "Invalid custom instructions for explanation.", analyzed_branch

        mapping_parts = []
        async for chunk in o4_service.call_o4_api_stream(
            system_prompt=SYSTEM_SECOND_PROMPT,
            data={"explanation": explanation, "file_tree": file_tree},
            api_key=llm_api_key, reasoning_effort="low",
        ):
            mapping_parts.append(chunk)
        component_mapping_text = "".join(mapping_parts)
        start_tag, end_tag = "<component_mapping>", "</component_mapping>"
        if start_tag in component_mapping_text and end_tag in component_mapping_text:
            component_mapping_text = component_mapping_text[
                component_mapping_text.find(start_tag) + len(start_tag) : component_mapping_text.rfind(end_tag)
            ].strip()
        else:
            print(f"Warning: <component_mapping> tags not found for {username}/{repo_name}. Using full response.")


        mermaid_code_parts = []
        async for chunk in o4_service.call_o4_api_stream(
            system_prompt=third_system_prompt,
            data={"explanation": explanation, "component_mapping": component_mapping_text, "instructions": custom_instructions},
            api_key=llm_api_key, reasoning_effort="low",
        ):
            mermaid_code_parts.append(chunk)
        mermaid_code = "".join(mermaid_code_parts)
        mermaid_code = mermaid_code.replace("```mermaid", "").replace("```", "").strip()
        if "BAD_INSTRUCTIONS" in mermaid_code and custom_instructions:
            return None, "Invalid custom instructions for diagram generation.", analyzed_branch

        return mermaid_code, None, analyzed_branch

    except Exception as e:
        print(f"Error in generate_mermaid_code_for_repo for {username}/{repo_name}: {e}")
        import traceback
        traceback.print_exc()
        return None, str(e), None