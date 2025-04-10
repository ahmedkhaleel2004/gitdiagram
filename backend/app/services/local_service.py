import requests
import jwt
import time
from datetime import datetime, timedelta
from dotenv import load_dotenv
import os
from pathlib import Path
from .base_service import BaseService

load_dotenv()

class LocalService(BaseService):  # Changed to inherit from BaseService
    def __init__(self, path: str | None = None):
        self.path = path
        base_path = Path(self.path) 
        if not base_path.exists():
            raise ValueError(f"Local path not exist {self.path}")
        if not base_path.is_dir():
            raise ValueError("Should provide a valid directory path")

    def get_file_paths_as_list(self):
        """
        Get the file paths of the local codebase, excluding static files and generated code.
        Returns:
            str: file path list after filtering
        """
        def scan_directory(base_path: Path):
            """recursively scan directories and filter files"""
            paths = []
            for entry in base_path.iterdir():
                if entry.name.startswith('.'): 
                    continue
                if entry.is_dir():
                    paths.extend(scan_directory(entry))
                else:
                    file_path = str(entry.relative_to(base_path))
                    if self._should_include_file(file_path):
                        paths.append(file_path)
            return paths
        
        try:
            base_path = Path(self.path) 
            if not base_path.exists():
                raise ValueError(f"local path not exist {self.path}")
            if not base_path.is_dir():
                raise ValueError("should provide the directory path")
                
            all_files = scan_directory(base_path)
            return "\n".join(all_files)
            
        except Exception as e:
            raise ValueError(f"cannot read the local codebase: {str(e)}")

    def get_readme(self):
        """
        Get the README file content of the local codebase.
        Returns:
            str: README file content
            
        Raises:
            ValueError: throw when readme file is not found
            FileNotFoundError: throw when readme file is not found
        """ 
        readme_files = ['README.md', 'README', 'readme.md']
        for filename in readme_files:
            readme_path = Path(self.path) / filename
            if readme_path.is_file():
                try:
                    return readme_path.read_text(encoding='utf-8')
                except UnicodeDecodeError:
                    continue
                
        raise FileNotFoundError("Cannot find the available readme file (support README.md/README/readme.md)")