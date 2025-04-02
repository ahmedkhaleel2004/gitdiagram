from abc import ABC, abstractmethod

class BaseService(ABC):
    @abstractmethod
    def get_file_paths_as_list(self, username, repo):
        raise NotImplementedError

    @abstractmethod
    def get_readme(self, username, repo):
        raise NotImplementedError

    # Shared utility method can be implemented here
    def _should_include_file(self, path):
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
  