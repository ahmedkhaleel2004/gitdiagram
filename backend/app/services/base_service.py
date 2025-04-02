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
        excluded_patterns = [
            "node_modules/", "vendor/", "venv/",
            ".min.", ".pyc", ".pyo", ".pyd",
            ".jpg", ".jpeg", ".png", ".gif",
            "__pycache__/", ".cache/", ".tmp/",
            "yarn.lock", "poetry.lock", "*.log",
            ".vscode/", ".idea/"
        ]
        return not any(pattern in path.lower() for pattern in excluded_patterns)