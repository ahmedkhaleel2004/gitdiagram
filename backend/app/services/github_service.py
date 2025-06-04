import requests
import jwt
import time
from datetime import datetime, timedelta
from dotenv import load_dotenv
import os
import logging

load_dotenv()

# Configure logging for better debugging
logger = logging.getLogger(__name__)


class GitHubService:
    def __init__(self, pat: str | None = None):
        # Try app authentication first
        self.client_id = os.getenv("GITHUB_CLIENT_ID")
        self.private_key = os.getenv("GITHUB_PRIVATE_KEY")
        self.installation_id = os.getenv("GITHUB_INSTALLATION_ID")

        # Use provided PAT if available, otherwise fallback to env PAT
        self.github_token = pat or os.getenv("GITHUB_PAT")

        # If no credentials are provided, warn about rate limits
        if (
            not all([self.client_id, self.private_key, self.installation_id])
            and not self.github_token
        ):
            logger.warning(
                "No GitHub credentials provided. Using unauthenticated requests with rate limit of 60 requests/hour."
            )
            print(
                "\033[93mWarning: No GitHub credentials provided. Using unauthenticated requests with rate limit of 60 requests/hour.\033[0m"
            )

        self.access_token = None
        self.token_expires_at = None

    # autopep8: off
    def _generate_jwt(self):
        now = int(time.time())
        payload = {
            "iat": now,
            "exp": now + (10 * 60),  # 10 minutes
            "iss": self.client_id,
        }
        # Convert PEM string format to proper newlines
        return jwt.encode(payload, self.private_key, algorithm="RS256")  # type: ignore

    # autopep8: on

    def _get_installation_token(self):
        if self.access_token and self.token_expires_at > datetime.now():  # type: ignore
            return self.access_token

        jwt_token = self._generate_jwt()
        response = requests.post(
            f"https://api.github.com/app/installations/{
                self.installation_id}/access_tokens",
            headers={
                "Authorization": f"Bearer {jwt_token}",
                "Accept": "application/vnd.github+json",
            },
        )
        data = response.json()
        self.access_token = data["token"]
        self.token_expires_at = datetime.now() + timedelta(hours=1)
        return self.access_token

    def _get_headers(self):
        # If no credentials are available, return basic headers
        if (
            not all([self.client_id, self.private_key, self.installation_id])
            and not self.github_token
        ):
            return {"Accept": "application/vnd.github+json"}

        # Use PAT if available
        if self.github_token:
            return {
                "Authorization": f"token {self.github_token}",
                "Accept": "application/vnd.github+json",
            }

        # Otherwise use app authentication
        token = self._get_installation_token()
        return {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def _check_repository_exists(self, username, repo):
        """
        Check if the repository exists using the GitHub API.
        """
        api_url = f"https://api.github.com/repos/{username}/{repo}"
        response = requests.get(api_url, headers=self._get_headers())

        if response.status_code == 404:
            raise ValueError("Repository not found.")
        elif response.status_code == 403:
            # Check if it's a rate limit issue
            if 'rate limit' in response.text.lower():
                raise Exception("GitHub API rate limit exceeded. Please configure GITHUB_PAT in environment variables or wait before trying again.")
            else:
                raise Exception("Access forbidden. Repository might be private and require authentication.")
        elif response.status_code != 200:
            logger.error(f"GitHub API error - Status: {response.status_code}, Response: {response.text}")
            raise Exception(
                f"Failed to check repository: {response.status_code}, {response.json()}"
            )

    def get_default_branch(self, username, repo):
        """Get the default branch of the repository."""
        api_url = f"https://api.github.com/repos/{username}/{repo}"
        response = requests.get(api_url, headers=self._get_headers())

        if response.status_code == 200:
            return response.json().get("default_branch")
        elif response.status_code == 403:
            logger.warning(f"Rate limit or access issue for {username}/{repo}: {response.status_code}")
        elif response.status_code == 404:
            logger.warning(f"Repository {username}/{repo} not found")
        else:
            logger.warning(f"Unexpected response for {username}/{repo}: {response.status_code}")
        
        return None

    def get_github_file_paths_as_list(self, username, repo):
        """
        Fetches the file tree of an open-source GitHub repository,
        excluding static files and generated code.

        Args:
            username (str): The GitHub username or organization name
            repo (str): The repository name

        Returns:
            str: A filtered and formatted string of file paths in the repository, one per line.
        """

        def should_include_file(path):
            # Patterns to exclude
            excluded_patterns = [
                # Dependencies
                "node_modules/",
                "vendor/",
                "venv/",
                # Compiled files
                ".min.",
                ".pyc",
                ".pyo",
                ".pyd",
                ".so",
                ".dll",
                ".class",
                # Asset files
                ".jpg",
                ".jpeg",
                ".png",
                ".gif",
                ".ico",
                ".svg",
                ".ttf",
                ".woff",
                ".webp",
                # Cache and temporary files
                "__pycache__/",
                ".cache/",
                ".tmp/",
                # Lock files and logs
                "yarn.lock",
                "poetry.lock",
                "*.log",
                # Configuration files
                ".vscode/",
                ".idea/",
            ]

            return not any(pattern in path.lower() for pattern in excluded_patterns)

        logger.info(f"Fetching file tree for {username}/{repo}")

        # Try to get the default branch first
        branch = self.get_default_branch(username, repo)
        if branch:
            logger.info(f"Using default branch: {branch}")
            api_url = f"https://api.github.com/repos/{username}/{repo}/git/trees/{branch}?recursive=1"
            response = requests.get(api_url, headers=self._get_headers())

            logger.info(f"GitHub API response status: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                if "tree" in data:
                    # Filter the paths and join them with newlines
                    paths = [
                        item["path"]
                        for item in data["tree"]
                        if should_include_file(item["path"])
                    ]
                    logger.info(f"Successfully fetched {len(paths)} file paths")
                    return "\n".join(paths)
            elif response.status_code == 403:
                error_msg = "GitHub API rate limit exceeded or access denied."
                if not self.github_token:
                    error_msg += " Consider configuring GITHUB_PAT environment variable for higher rate limits (5000/hour vs 60/hour)."
                logger.error(f"{error_msg} Response: {response.text}")
                raise ValueError(error_msg)
            elif response.status_code == 404:
                logger.error(f"Branch {branch} not found for {username}/{repo}")
            else:
                logger.error(f"Unexpected response for {username}/{repo} branch {branch}: {response.status_code} - {response.text}")

        # If default branch didn't work or wasn't found, try common branch names
        logger.info("Trying common branch names: main, master")
        for branch in ["main", "master"]:
            api_url = f"https://api.github.com/repos/{username}/{repo}/git/trees/{branch}?recursive=1"
            response = requests.get(api_url, headers=self._get_headers())

            logger.info(f"Branch {branch} response status: {response.status_code}")

            if response.status_code == 200:
                data = response.json()
                if "tree" in data:
                    # Filter the paths and join them with newlines
                    paths = [
                        item["path"]
                        for item in data["tree"]
                        if should_include_file(item["path"])
                    ]
                    logger.info(f"Successfully fetched {len(paths)} file paths from branch {branch}")
                    return "\n".join(paths)
            elif response.status_code == 403:
                error_msg = "GitHub API rate limit exceeded or access denied."
                if not self.github_token:
                    error_msg += " Consider configuring GITHUB_PAT environment variable for higher rate limits (5000/hour vs 60/hour)."
                logger.error(f"{error_msg} Response: {response.text}")
                raise ValueError(error_msg)
            elif response.status_code == 404:
                logger.info(f"Branch {branch} not found, trying next...")
                continue
            else:
                logger.error(f"Unexpected response for branch {branch}: {response.status_code} - {response.text}")

        # Enhanced error message with debugging info
        auth_status = "authenticated" if self.github_token else "unauthenticated"
        logger.error(f"Failed to fetch file tree for {username}/{repo} using {auth_status} requests")
        
        error_msg = f"Could not fetch repository file tree for {username}/{repo}. "
        if not self.github_token:
            error_msg += "Repository might be private, empty, or GitHub API rate limit exceeded (60/hour for unauthenticated requests). Consider configuring GITHUB_PAT environment variable."
        else:
            error_msg += "Repository might not exist, be empty, or branch access might be restricted."
            
        raise ValueError(error_msg)

    def get_github_readme(self, username, repo):
        """
        Fetches the README contents of an open-source GitHub repository.

        Args:
            username (str): The GitHub username or organization name
            repo (str): The repository name

        Returns:
            str: The contents of the README file.

        Raises:
            ValueError: If repository does not exist or has no README.
            Exception: For other unexpected API errors.
        """
        logger.info(f"Fetching README for {username}/{repo}")
        
        # First check if the repository exists
        try:
            self._check_repository_exists(username, repo)
        except Exception as e:
            logger.error(f"Repository existence check failed: {e}")
            raise

        # Then attempt to fetch the README
        api_url = f"https://api.github.com/repos/{username}/{repo}/readme"
        response = requests.get(api_url, headers=self._get_headers())

        logger.info(f"README API response status: {response.status_code}")

        if response.status_code == 404:
            logger.warning(f"No README found for {username}/{repo}")
            raise ValueError("No README found for the specified repository.")
        elif response.status_code == 403:
            error_msg = "GitHub API rate limit exceeded or access denied while fetching README."
            if not self.github_token:
                error_msg += " Consider configuring GITHUB_PAT environment variable."
            logger.error(f"{error_msg} Response: {response.text}")
            raise Exception(error_msg)
        elif response.status_code != 200:
            logger.error(f"README fetch failed: {response.status_code} - {response.text}")
            raise Exception(
                f"Failed to fetch README: {response.status_code}, {response.json()}"
            )

        data = response.json()
        readme_response = requests.get(data["download_url"])
        
        if readme_response.status_code != 200:
            logger.error(f"README download failed: {readme_response.status_code}")
            raise Exception(f"Failed to download README content: {readme_response.status_code}")
            
        logger.info(f"Successfully fetched README for {username}/{repo}")
        return readme_response.text
