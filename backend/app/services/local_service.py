import requests
import jwt
import time
from datetime import datetime, timedelta
from dotenv import load_dotenv
import os

load_dotenv()


class LocalService:
    def __init__(self, path: str | None = None):
        self.path = path

    def _get_headers(self):
        return {
            "Authorization": "Bearer",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def get_default_branch(self, username, repo):
        """Get the default branch of the repository."""
        api_url = f"https://api.github.com/repos/{username}/{repo}"
        response = requests.get(api_url, headers=self._get_headers())

        if response.status_code == 200:
            return response.json().get("default_branch")
        return None

    # 新增本地文件处理方法
    def get_github_file_paths_as_list(self, local_path: str, username=None):
        """
        Get the file paths of the local codebase, excluding static files and generated code.
        
        Args:
            local_path (str): the absolute path of the local codebase
            
        Returns:
            str: file path list after filtering
        """
        from pathlib import Path
        
        def scan_directory(path: Path):
            """recursively scan the directory"""
            paths = []
            for entry in path.iterdir():
                if entry.name.startswith('.'):  # 排除隐藏文件/目录
                    continue
                if entry.is_dir():
                    paths.extend(scan_directory(entry))
                else:
                    file_path = str(entry.relative_to(base_path))  # 修改这里使用 base_path
                    if self._should_include_file(file_path):
                        paths.append(file_path)
            return paths
        
        try:
            base_path = Path(local_path) 
            if not base_path.exists():
                raise ValueError(f"Local path not exist {local_path}")
            if not base_path.is_dir():
                raise ValueError("Should provide a valid directory path")
                
            all_files = scan_directory(base_path)
            return "\n".join(all_files)
            
        except Exception as e:
            raise ValueError(f"Connot read local file: {str(e)}")

    def get_github_readme(self, username, repo):
        """
        获取本地代码库的README内容
        
        Args:
            local_path (str): the absolute path of the local codebase
            
        Returns:
            str: README file content
            
        Raises:
            ValueError: throw when readme file is not found
            FileNotFoundError: throw when readme file is not found
        """
        from pathlib import Path
        local_path = "/app/code/evals"
        
        base_path = Path(local_path)
        if not base_path.exists():
            raise ValueError("The local path does not exist.")
        if not base_path.is_dir():
            raise ValueError("The provided path is not a directory.")
            
        readme_files = ['README.md', 'README', 'readme.md']
        for filename in readme_files:
            readme_path = base_path / filename
            if readme_path.is_file():
                try:
                    return readme_path.read_text(encoding='utf-8')
                except UnicodeDecodeError:
                    continue
                
        raise FileNotFoundError("Cannot find the available readme file (support README.md/README/readme.md)")
   
    def _should_include_file(self, path):
        """
        keep the original logic for filtering files
        """
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
  