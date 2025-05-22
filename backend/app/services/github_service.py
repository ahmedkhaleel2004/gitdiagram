# backend/app/services/github_service.py
import os
import time 
from github import Github, Auth, GithubIntegration, GithubException
from dotenv import load_dotenv
import traceback # Make sure traceback is imported for debugging

# Load .env from the project root
project_root_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '.env')
if os.path.exists(project_root_env_path):
    load_dotenv(dotenv_path=project_root_env_path)
else:
    load_dotenv() # Default search

class GitHubService:
    def __init__(self):
        self.github_instance = None
        self.auth_method_used = "None Initialized" 

        print("--- GitHubService Initialization Attempt ---")

        app_id_str = os.getenv("GITHUB_APP_ID")
        installation_id_str = os.getenv("GITHUB_APP_INSTALLATION_ID")
        private_key_from_env = os.getenv("GITHUB_APP_PRIVATE_KEY") 
        private_key_path = os.getenv("GITHUB_APP_PRIVATE_KEY_PATH") 

        print(f"  Env GITHUB_APP_ID: '{app_id_str}' (Type: {type(app_id_str)})")
        print(f"  Env GITHUB_APP_INSTALLATION_ID: '{installation_id_str}' (Type: {type(installation_id_str)})")
        # ... (other initial prints for key path/env presence) ...
        actual_private_key_content = None
        # ... (logic for loading actual_private_key_content as before) ...
        if private_key_from_env and private_key_from_env.strip(): # Added condition
            actual_private_key_content = private_key_from_env.replace("\\n", "\n") 
            print("  Successfully loaded private key from GITHUB_APP_PRIVATE_KEY env var.")
        # ... (else if path, else neither) ...

        can_attempt_app_auth = bool(
            app_id_str and app_id_str.strip() and
            actual_private_key_content and actual_private_key_content.strip() and
            installation_id_str and installation_id_str.strip()
        )
        print(f"  Can attempt GitHub App Authentication: {can_attempt_app_auth}")

        if can_attempt_app_auth:
            try:
                app_id = int(app_id_str)
                installation_id = int(installation_id_str)

                print(f"  Attempting App Auth with AppID: {app_id}, InstallID: {installation_id}, Key content present: {'Yes' if actual_private_key_content and actual_private_key_content.strip() else 'No'}")
                
                git_integration = GithubIntegration(
                    app_id,
                    actual_private_key_content,
                )
                print("  GithubIntegration object created.")
                
                installation_auth = git_integration.get_access_token(installation_id)
                # print(f"  get_access_token response object: {installation_auth}") # Can be verbose

                if not installation_auth or not installation_auth.token:
                    print("  Error: Failed to obtain a valid installation access token (token object or token itself is None/empty).")
                    raise Exception("Failed to obtain installation access token.")
                
                print(f"  Obtained installation access token (snippet): {installation_auth.token[:20]}...")
                self.github_instance = Github(login_or_token=installation_auth.token)
                self.auth_method_used = "GitHub App" # Set this immediately after successful tokenization
                
                # MODIFIED TEST: Instead of get_user(), just confirm token was set.
                # The real test will be when get_repo_object is called by the application.
                # We've already confirmed installation_auth.token is not None.
                print(f"  GitHubService: Successfully initialized PyGithub with App Installation Token. Method: {self.auth_method_used}. Token expires at: {installation_auth.expires_at}")
                # If we want a lightweight API call to verify, we could try fetching app details,
                # but for now, having the token is the main step.
                # Example: app_details = git_integration.get_app()
                # print(f"  App Details: {app_details.name}, {app_details.slug}")

            except ValueError as ve: 
                print(f"  Error: Invalid App ID or Installation ID (not integers): {ve}")
                self.github_instance = None # Ensure fallback
            except GithubException as ge: 
                print(f"  Error: PyGithubException during GitHub App credentials initialization: {ge.status} {ge.data}") 
                self.github_instance = None # Ensure fallback
            except Exception as e: 
                print(f"  Error: General exception during GitHub App credentials initialization: {e}")
                # import traceback # Keep this commented unless needed for very obscure errors
                # traceback.print_exc()
                self.github_instance = None # Ensure fallback
        else:
            print("  Info: Not attempting App Auth due to missing or empty credentials.")
        
        # Fallback logic
        if not self.github_instance:
            print("  Attempting fallback authentication methods...")
            pat_token = os.getenv("GITHUB_PAT")
            if pat_token and pat_token.strip(): 
                self.github_instance = Github(pat_token)
                self.auth_method_used = "Personal Access Token (GITHUB_PAT Fallback)"
                print(f"  GitHubService: Initialized with GITHUB_PAT (Fallback).")
            else:
                self.github_instance = Github() 
                self.auth_method_used = "Unauthenticated (Fallback)"
                print("  GitHubService Warning: No App credentials or GITHUB_PAT. Using unauthenticated access.")

        if not self.github_instance:
             raise Exception("GitHubService critical failure: Could not initialize any PyGithub instance.")
        print(f"--- GitHubService Initialization Complete. Method used: {self.auth_method_used} ---")
        

    # Ensure all subsequent methods are correctly indented at the class level (one indent from class GitHubService:)
    def get_repo_object(self, repo_full_name: str):
        """Helper to get a repository object using the initialized PyGithub instance."""
        if not self.github_instance:
            raise Exception("GitHubService not properly initialized with an auth method before get_repo_object.")
        try:
            print(f"  GitHubService [get_repo_object]: Attempting to get repo '{repo_full_name}' using auth: {self.auth_method_used}")
            return self.github_instance.get_repo(repo_full_name)
        except GithubException as e:
            print(f"  GitHubService Error [get_repo_object]: Could not get repo object for '{repo_full_name}' (using {self.auth_method_used}). Status: {e.status}, Data: {e.data}")
            raise 

    def get_default_branch(self, username: str, repo_name_only: str) -> str | None:
        repo_full_name = f"{username}/{repo_name_only}"
        try:
            repo_obj = self.get_repo_object(repo_full_name)
            return repo_obj.default_branch
        except Exception as e:
            print(f"GitHubService Info [get_default_branch]: Failed to get default branch for {repo_full_name} due to: {e}")
            return None

    def _fetch_tree(self, repo_obj, branch_sha_or_name: str):
        try:
            tree = repo_obj.get_git_tree(sha=branch_sha_or_name, recursive=True).tree
            return tree
        except GithubException as e:
            print(f"GitHubService Error [_fetch_tree]: Failed to fetch git tree for branch/SHA '{branch_sha_or_name}' in repo '{repo_obj.full_name}'. Status: {e.status}, Data: {e.data}")
            return None

    def get_github_file_paths_as_list(self, username: str, repo_name_only: str, branch_name: str | None = None) -> str:
        repo_full_name = f"{username}/{repo_name_only}"
        repo_obj = self.get_repo_object(repo_full_name) 
        
        actual_branch_to_query = branch_name or repo_obj.default_branch
        
        tree_data = None
        if not actual_branch_to_query:
            print(f"GitHubService Warning [get_github_file_paths_as_list]: No specific branch and no default branch found for {repo_full_name}. Trying 'main', then 'master'.")
            common_branches_to_try = ["main", "master"]
            for common_branch in common_branches_to_try:
                print(f"GitHubService Info [get_github_file_paths_as_list]: Attempting branch '{common_branch}' for {repo_full_name}.")
                tree_data = self._fetch_tree(repo_obj, common_branch)
                if tree_data is not None:
                    actual_branch_to_query = common_branch 
                    break
            if tree_data is None:
                raise ValueError(f"Could not fetch file tree. No valid branch (tried common fallbacks) found for {repo_full_name}.")
        else:
            print(f"GitHubService [get_github_file_paths_as_list]: Fetching file tree for {repo_full_name} on branch '{actual_branch_to_query}'")
            tree_data = self._fetch_tree(repo_obj, actual_branch_to_query)
            if tree_data is None:
                 raise ValueError(f"Could not fetch file tree for specified branch '{actual_branch_to_query}' in {repo_full_name}.")

        def should_include_file(path_str: str) -> bool:
            excluded_patterns = [
                ".git/", "node_modules/", "vendor/", "venv/", ".vscode/", ".idea/",
                "__pycache__/", "*.pyc", "*.pyo", "*.pyd", "*.so", "*.dll", "*.class",
                ".min.", ".lock", ".log", "package-lock.json", "pnpm-lock.yaml",
                ".jpg", ".jpeg", ".png", ".gif", ".ico", ".svg", ".ttf", ".woff", ".woff2", ".webp", ".mp4", ".mov",
                ".cache/", ".tmp/", "dist/", "build/", "out/", "target/", ".DS_Store"
            ] 
            return not any(excluded_item in path_str.lower() for excluded_item in excluded_patterns)

        paths = [element.path for element in tree_data if element.type == 'blob' and should_include_file(element.path)]
        print(f"GitHubService [get_github_file_paths_as_list]: Found {len(paths)} relevant files for {repo_full_name} on branch '{actual_branch_to_query}'.")
        return "\n".join(paths)

    def get_github_readme(self, username: str, repo_name_only: str, branch_name: str | None = None) -> str:
        repo_full_name = f"{username}/{repo_name_only}"
        repo_obj = self.get_repo_object(repo_full_name) 
        
        actual_branch_to_query = branch_name or repo_obj.default_branch
        ref_to_use = actual_branch_to_query 

        print(f"GitHubService [get_github_readme]: Fetching README for {repo_full_name} from branch/ref '{ref_to_use or '(default)'}'")
        
        common_readme_names = ["README.md", "readme.md", "README.rst", "readme.rst", "README", "readme"]
        for name_variant in common_readme_names:
            try:
                readme_content_item = repo_obj.get_contents(name_variant, ref=ref_to_use)
                print(f"GitHubService [get_github_readme]: Found README as '{name_variant}' for {repo_full_name} on branch '{ref_to_use or '(default)'}'.")
                return readme_content_item.decoded_content.decode("utf-8")
            except GithubException as e:
                if e.status == 404:
                    continue 
                else: 
                    print(f"GitHubService Error [get_github_readme]: Fetching README variant '{name_variant}' for {repo_full_name} failed. Status: {e.status}, Data: {e.data}")
                    raise 
        
        final_branch_identifier = ref_to_use or "default"
        print(f"GitHubService Error [get_github_readme]: No README file (tried common names) found for {repo_full_name} on branch/ref '{final_branch_identifier}'.")
        raise ValueError(f"No README file found for {repo_full_name} on branch/ref '{final_branch_identifier}'.")