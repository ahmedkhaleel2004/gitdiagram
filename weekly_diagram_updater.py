# ~/gitdiagram/weekly_diagram_updater.py
import requests
import os
import time
from dotenv import load_dotenv

# --- Configuration ---
# Load environment variables from .env in the script's directory or project root
script_dir = os.path.dirname(os.path.abspath(__file__))
dotenv_path_script_dir = os.path.join(script_dir, '.env')
dotenv_path_project_root = os.path.join(os.path.dirname(script_dir), '.env') # If script is in a subdir like 'scripts'

if os.path.exists(dotenv_path_script_dir):
    load_dotenv(dotenv_path_script_dir)
    print(f"Loaded .env from script directory: {dotenv_path_script_dir}")
elif os.path.exists(dotenv_path_project_root):
    load_dotenv(dotenv_path_project_root)
    print(f"Loaded .env from project root: {dotenv_path_project_root}")
else:
    print("Warning: .env file not found in script directory or project root. Relying on shell environment.")

GITDIAGRAM_BACKEND_URL = os.getenv("GITDIAGRAM_EC2_URL", "http://localhost:8000/internal/update-readme-diagram")
INTERNAL_TOKEN = os.getenv("GITDIAGRAM_INTERNAL_SECRET_TOKEN")
REPOS_FILE_PATH = os.path.join(script_dir, "repos_to_update.txt")
DEFAULT_BRANCH_TO_UPDATE = "master" # Or "master", or make configurable
# --- End Configuration ---

def get_repos_from_file(file_path):
    repos = []
    try:
        with open(file_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    repos.append(line)
        print(f"Found {len(repos)} repositories to process from {file_path}")
    except FileNotFoundError:
        print(f"Error: Repositories file not found at {file_path}")
    return repos

def trigger_readme_update(repo_full_name, branch_name):
    if not GITDIAGRAM_BACKEND_URL:
        print("Error: GITDIAGRAM_EC2_URL is not set. Cannot contact backend.")
        return False
    if not INTERNAL_TOKEN:
        print("Error: GITDIAGRAM_INTERNAL_SECRET_TOKEN is not set. Cannot authenticate.")
        return False

    payload = {
        "repo_full_name": repo_full_name,
        "branch_name": branch_name
    }
    headers = {
        "Content-Type": "application/json",
        "X-INTERNAL-TOKEN": INTERNAL_TOKEN
    }

    print(f"  Attempting to trigger update for {repo_full_name} (branch: {branch_name}) via {GITDIAGRAM_BACKEND_URL}...")
    try:
        # Increased timeout for potentially long diagram generation + commit
        response = requests.post(GITDIAGRAM_BACKEND_URL, json=payload, headers=headers, timeout=300) # 5 minutes
        
        print(f"  Response Status Code: {response.status_code}")
        try:
            response_data = response.json()
            print(f"  Response JSON: {response_data}")
        except requests.exceptions.JSONDecodeError:
            response_data = {}
            print(f"  Response Text (not JSON): {response.text}")

        if response.status_code == 200 and response_data.get('status') == 'ok':
            print(f"  Successfully triggered update for {repo_full_name}. Message: {response_data.get('message', 'N/A')}")
            return True
        else:
            print(f"  Failed to trigger update for {repo_full_name}. Status: {response.status_code}. Error: {response_data.get('detail', response.text)}")
            return False

    except requests.exceptions.RequestException as e:
        print(f"  Error calling backend for {repo_full_name}: {e}")
    except Exception as e:
        print(f"  An unexpected error occurred while triggering update for {repo_full_name}: {e}")
    return False

def main():
    print("Starting weekly GitDiagram README update process...")
    
    repos_to_process = get_repos_from_file(REPOS_FILE_PATH)
    if not repos_to_process:
        print("No repositories found in config file. Exiting.")
        return

    successful_updates = 0
    failed_updates = 0

    for i, repo_full_name in enumerate(repos_to_process):
        print(f"\nProcessing repository {i+1}/{len(repos_to_process)}: {repo_full_name}")
        if trigger_readme_update(repo_full_name, DEFAULT_BRANCH_TO_UPDATE):
            successful_updates += 1
        else:
            failed_updates += 1
        
        if i < len(repos_to_process) - 1: # Don't sleep after the last repo
            print(f"  Waiting for 10 seconds before next repository...")
            time.sleep(10) 

    print("\n--- Weekly Update Summary ---")
    print(f"Total repositories processed: {len(repos_to_process)}")
    print(f"Successful updates: {successful_updates}")
    print(f"Failed updates: {failed_updates}")
    print("Weekly GitDiagram README update process finished.")

if __name__ == "__main__":
    main()