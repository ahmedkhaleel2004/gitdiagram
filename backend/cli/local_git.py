import os


def build_file_tree(repo_path):
    """
    Traverse the local repository and build a file tree string.
    Excludes specified patterns similar to GitHubService.
    """
    excluded_patterns = [
        'node_modules', 'vendor', 'venv',
        '.min.', '.pyc', '.pyo', '.pyd', '.so', '.dll', '.class',
        '.jpg', '.jpeg', '.png', '.gif', '.ico', '.svg', '.ttf', '.woff', '.webp',
        '.pdf', '.xml', '.wav', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
        '__pycache__', '.cache', '.tmp',
        'yarn.lock', 'poetry.lock', '*.log',
        '.vscode', '.idea', '.git'
    ]

    file_paths = []
    for root, dirs, files in os.walk(repo_path):
        # Modify dirs in-place to skip excluded directories
        dirs[:] = [d for d in dirs if not any(
            excl in d.lower() for excl in excluded_patterns)]
        for file in files:
            file_path = os.path.join(root, file)
            relative_path = os.path.relpath(file_path, repo_path)
            if not any(excl in relative_path.lower() for excl in excluded_patterns):
                # For Windows compatibility
                file_paths.append(relative_path.replace("\\", "/"))

    return "\n".join(file_paths)


def get_readme(repo_path):
    """
    Fetch the README content from the local repository.
    """
    readme_path = os.path.join(repo_path, "README.md")
    if os.path.exists(readme_path):
        with open(readme_path, 'r', encoding='utf-8') as f:
            return f.read()
    return ""
