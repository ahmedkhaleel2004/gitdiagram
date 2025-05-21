# backend/app/utils/readme_updater.py
import os
import re
from github import Github, GithubException, Auth # PyGithub
from app.utils.diagram_generator_util import generate_mermaid_code_for_repo
from app.services.github_service import GitHubService # Your existing GitHub service

GITDIAGRAM_START_MARKER = "<!-- GITDIAGRAM_START -->"
GITDIAGRAM_END_MARKER = "<!-- GITDIAGRAM_END -->"
COMMIT_MESSAGE = "docs: Update architecture diagram [skip ci]"

def process_click_events_for_readme(diagram: str, username: str, repo: str, branch_for_urls: str) -> str:
    # This function is from your generate.py, ensure it's robust
    def replace_path(match):
        path = match.group(2).strip("\"'")
        is_file = "." in path.split("/")[-1]
        base_url = f"https://github.com/{username}/{repo}"
        path_type = "blob" if is_file else "tree"
        # IMPORTANT: branch_for_urls should be the branch where the README will LIVE (e.g., "main")
        full_url = f"{base_url}/{path_type}/{branch_for_urls}/{path}"
        return f'click {match.group(1)} "{full_url}"'
    click_pattern = r'click ([^\s"]+)\s+"([^"]+)"'
    return re.sub(click_pattern, replace_path, diagram)

async def update_readme_with_new_diagram(
    repo_full_name: str,
    branch_to_commit_to: str, # e.g., "main"
    github_pat_for_updates: str, # PAT to commit README changes
    llm_api_key: str | None = None,
    github_pat_for_repo_read: str | None = None
    ) -> bool:
    print(f"Starting README update for {repo_full_name} on branch {branch_to_commit_to}")
    owner, repo_name_only = repo_full_name.split('/')

    try:
        # 1. Generate the new Mermaid diagram
        # The diagram should reflect the state of the branch_to_commit_to (e.g., "main")
        print(f"Generating diagram for {repo_full_name} (analyzing branch: {branch_to_commit_to})...")
        raw_mermaid_code, error_msg, analyzed_branch = await generate_mermaid_code_for_repo(
            username=owner,
            repo_name=repo_name_only,
            github_pat_for_reading_repo=github_pat_for_repo_read,
            llm_api_key=llm_api_key,
            target_branch_for_analysis=branch_to_commit_to # Analyze the target branch
        )

        if error_msg or not raw_mermaid_code:
            print(f"Error generating diagram for {repo_full_name}: {error_msg or 'No diagram content'}")
            return False
        print(f"Diagram generated successfully for {repo_full_name} based on branch {analyzed_branch}")

        # URLs in click events should point to the branch where the README lives (branch_to_commit_to)
        mermaid_code_with_clicks = process_click_events_for_readme(raw_mermaid_code, owner, repo_name_only, branch_to_commit_to)

        # 2. Connect to GitHub to update README
        auth_for_commit = Auth.Token(github_pat_for_updates)
        g_for_commit = Github(auth=auth_for_commit)
        repo_gh_obj = g_for_commit.get_repo(repo_full_name)

        # 3. Get current README from the branch_to_commit_to
        print(f"Fetching README.md for {repo_full_name} from branch {branch_to_commit_to}...")
        try:
            readme_content_item = repo_gh_obj.get_contents("README.md", ref=branch_to_commit_to)
            readme_text = readme_content_item.decoded_content.decode("utf-8")
            readme_sha = readme_content_item.sha
        except GithubException as e:
            if e.status == 404:
                print(f"README.md not found on branch {branch_to_commit_to}. Creating a new one.")
                readme_text = f"# {repo_name_only}\n\nThis is an auto-generated README for {repo_full_name}."
                readme_sha = None
            else:
                print(f"Error fetching README from branch {branch_to_commit_to} for {repo_full_name}: {e}")
                return False

        # 4. Prepare new README content
        diagram_block = f"{GITDIAGRAM_START_MARKER}\n\n```mermaid\n{mermaid_code_with_clicks}\n```\n\n{GITDIAGRAM_END_MARKER}"
        start_idx = readme_text.find(GITDIAGRAM_START_MARKER)
        end_idx_marker = readme_text.find(GITDIAGRAM_END_MARKER)
        if start_idx != -1 and end_idx_marker != -1 and end_idx_marker > start_idx:
            end_idx = end_idx_marker + len(GITDIAGRAM_END_MARKER)
            new_readme_text = readme_text[:start_idx] + diagram_block + readme_text[end_idx:]
        else:
            print("Diagram markers not found or in wrong order. Prepending new diagram to README.")
            new_readme_text = diagram_block + "\n\n" + readme_text
        
        if readme_text.strip() == new_readme_text.strip(): # Avoid commit if no actual change
            print(f"README for {repo_full_name} on branch {branch_to_commit_to} is already up-to-date.")
            return True

        # 5. Commit updated README to the branch_to_commit_to
        commit_args = {
            "path": "README.md",
            "message": COMMIT_MESSAGE,
            "content": new_readme_text,
            "branch": branch_to_commit_to 
        }
        if readme_sha: # Update existing file
            print(f"Updating existing README.md on branch {branch_to_commit_to} for {repo_full_name}...")
            repo_gh_obj.update_file(**commit_args, sha=readme_sha)
        else: # Create new file
            print(f"Creating new README.md on branch {branch_to_commit_to} for {repo_full_name}...")
            repo_gh_obj.create_file(**commit_args)
            
        print(f"Successfully updated README.md for {repo_full_name} on branch {branch_to_commit_to}")
        return True

    except Exception as e:
        print(f"An unexpected error occurred while updating README for {repo_full_name} on branch {branch_to_commit_to}: {e}")
        import traceback
        traceback.print_exc()
        return False