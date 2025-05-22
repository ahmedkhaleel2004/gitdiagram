# backend/app/utils/diagram_generator_util.py
import asyncio
import json
# from functools import lru_cache # LRU Cache might be problematic with service instances, consider alternatives if caching is critical

from app.services.github_service import GitHubService
from app.services.o4_mini_openai_service import OpenAIo4Service
from app.prompts import (
    SYSTEM_FIRST_PROMPT,
    SYSTEM_SECOND_PROMPT,
    SYSTEM_THIRD_PROMPT,
    ADDITIONAL_SYSTEM_INSTRUCTIONS_PROMPT,
)

def get_repo_data_for_diagram(username: str, repo: str, github_service_instance: GitHubService, target_branch_for_analysis: str | None = None):
    """
    Fetches repository data using a pre-initialized GitHubService instance.
    """
    actual_branch_to_analyze = target_branch_for_analysis or github_service_instance.get_default_branch(username, repo)
    if not actual_branch_to_analyze:
        actual_branch_to_analyze = "main" # Fallback, consider "master" too or raise
        print(f"DiagramUtil Warning: Could not determine branch for analysis for {username}/{repo}, defaulting to '{actual_branch_to_analyze}'.")
        
    print(f"DiagramUtil: Fetching data for {username}/{repo} targeting analysis of branch '{actual_branch_to_analyze}'")
    
    # Pass the actual_branch_to_analyze to GitHubService methods
    file_tree = github_service_instance.get_github_file_paths_as_list(username, repo, branch_name=actual_branch_to_analyze)
    readme_content = github_service_instance.get_github_readme(username, repo, branch_name=actual_branch_to_analyze)
    
    return {"analyzed_branch": actual_branch_to_analyze, "file_tree": file_tree, "readme": readme_content}

async def generate_mermaid_code_for_repo(
    username: str,
    repo_name: str,
    # github_pat_for_reading_repo: str | None = None, # Replaced by github_service_instance
    llm_api_key: str | None = None,
    custom_instructions: str = "",
    target_branch_for_analysis: str | None = None 
) -> tuple[str | None, str | None, str | None]: # Returns (mermaid_code, error_message, analyzed_branch_name)
    
    # Initialize GitHubService here. It will use App Auth if configured in .env
    # This ensures each call to generate_mermaid_code_for_repo uses a fresh auth context if needed,
    # especially important if App tokens are short-lived (PyGithub handles renewal for installation tokens).
    github_service = GitHubService()
    o4_service = OpenAIo4Service()

    try:
        repo_data = get_repo_data_for_diagram(username, repo_name, github_service, target_branch_for_analysis)
        file_tree = repo_data["file_tree"]
        readme = repo_data["readme"]
        analyzed_branch = repo_data["analyzed_branch"] 

        # ... (rest of the token counting, prompt preparation, LLM calls as in your snapshot) ...
        # Ensure that data passed to LLM (file_tree, readme) is from the 'analyzed_branch'
        combined_content = f"{file_tree}\n{readme}"
        token_count = o4_service.count_tokens(combined_content)
        if token_count > 195000: # Example limit
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
        start_tag_map, end_tag_map = "<component_mapping>", "</component_mapping>" # Renamed for clarity
        if start_tag_map in component_mapping_text and end_tag_map in component_mapping_text:
            try:
                start_index = component_mapping_text.index(start_tag_map) + len(start_tag_map)
                end_index = component_mapping_text.index(end_tag_map, start_index)
                component_mapping_text = component_mapping_text[start_index:end_index].strip()
            except ValueError: # If tags are present but not correctly nested or find fails
                print(f"Warning: Error parsing <component_mapping> tags for {username}/{repo_name}. Using full response for mapping.")
                # component_mapping_text remains full_second_response as a fallback
        else:
            print(f"Warning: <component_mapping> tags not found for {username}/{repo_name}. Using full response for mapping.")


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

        return mermaid_code, None, analyzed_branch # Return analyzed_branch

    except Exception as e:
        print(f"Error in generate_mermaid_code_for_repo for {username}/{repo_name}: {e}")
        import traceback
        traceback.print_exc()
        return None, str(e), None # Ensure three values are returned on error too
        