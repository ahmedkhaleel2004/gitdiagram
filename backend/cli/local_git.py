import os
from collections import Counter


def build_file_tree(repo_path):
    """
    Traverse the local repository and build a file tree list.
    """
    excluded_patterns = [
        'node_modules', 'vendor', 'venv',
        '.min.', '.pyc', '.pyo', '.pyd', '.so', '.dll', '.class', ".o",
        '.jpg', '.jpeg', '.png', '.gif', '.ico', '.svg', '.ttf', '.woff', '.webp',
        '.pdf', '.xml', '.wav', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', ".txt", ".log",
        '__pycache__', '.cache', '.tmp',
        'yarn.lock', 'poetry.lock',
        '.vscode', '.idea', '.git', "test", "activate"
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

    return file_paths  # Return as list instead of string for easier processing


def get_readme(repo_path):
    """
    Fetch the README content from the local repository.
    """
    readme_path = os.path.join(repo_path, "README.md")
    if os.path.exists(readme_path):
        with open(readme_path, 'r', encoding='utf-8') as f:
            return f.read()
    return ""


def analyze_extension_percentage(file_paths):
    """
    Analyze the percentage distribution of file extensions in the provided file list.

    Args:
        file_paths (list): List of file paths.

    Returns:
        dict: Dictionary mapping file extensions to their percentage occurrence.
    """
    extensions = [os.path.splitext(file)[1].lower()
                  for file in file_paths if os.path.splitext(file)[1]]
    total = len(extensions)
    if total == 0:
        return {}
    counts = Counter(extensions)
    percentages = {ext: (count / total) * 100 for ext, count in counts.items()}

    sorted_percentages = dict(
        sorted(percentages.items(), key=lambda item: item[1], reverse=True))
    return sorted_percentages


def print_stat(repo_path):
    file_list = build_file_tree(repo_path)
    for f in file_list:
        print(f)
    extension_percentages = analyze_extension_percentage(file_list)

    print("File Extension Percentage Distribution:")
    for ext, percent in extension_percentages.items():
        print(f"{ext or 'No Extension'}: {percent:.2f}%")
