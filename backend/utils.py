import os
import shutil
import tempfile
import git
import pathspec
from typing import List, Tuple, Dict, Any

DEFAULT_IGNORE_PATTERNS = [
    ".git/",
    "node_modules/",
    "__pycache__/",
    "venv/",
    ".venv/",
    "env/",
    ".env",
    "dist/",
    "build/",
    ".next/",
    ".nuxt/",
    ".cache/",
    ".pytest_cache/",
    ".idea/",
    ".vscode/",
    "*.pyc",
    "*.pyo",
    "*.pyd",
    "*.db",
    "*.sqlite",
    ".DS_Store",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "poetry.lock",
    "Cargo.lock",
    "composer.lock",
    "Gemfile.lock",
    "*.min.js",
    "*.min.css",
    "*.map",
]

def clone_git_repo(git_url: str) -> str:
    """Clones a git repository to a temporary directory and returns the path."""
    temp_dir = tempfile.mkdtemp(prefix="repo_assistant_")
    try:
        git.Repo.clone_from(git_url, temp_dir, depth=1)
        return temp_dir
    except Exception as e:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        raise RuntimeError(f"Failed to clone repository: {str(e)}")

def load_gitignore_spec(repo_path: str) -> pathspec.PathSpec:
    """Loads .gitignore patterns and returns a PathSpec match object."""
    patterns = list(DEFAULT_IGNORE_PATTERNS)
    gitignore_path = os.path.join(repo_path, ".gitignore")
    
    if os.path.exists(gitignore_path):
        try:
            with open(gitignore_path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        patterns.append(line)
        except Exception:
            pass
            
    return pathspec.PathSpec.from_lines("gitwildmatch", patterns)

def scan_repository(repo_path: str) -> Tuple[List[str], Dict[str, Any]]:
    """
    Scans the repository and returns:
    1. A list of relative paths of all code/text files.
    2. A nested dictionary representing the directory structure (for the folder tree UI).
    """
    repo_path = os.path.abspath(repo_path)
    gitignore_spec = load_gitignore_spec(repo_path)
    
    file_list = []
    tree = {"name": os.path.basename(repo_path) or "root", "type": "directory", "children": {}}
    
    # Text file extensions we care about
    valid_extensions = {
        # Python
        ".py",
        # JS / TS
        ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
        # Go
        ".go",
        # Web / Markups
        ".html", ".css", ".json", ".yaml", ".yml", ".toml", ".md",
        # Java / Kotlin / Scala
        ".java", ".kt", ".scala",
        # C / C++ / C#
        ".c", ".cpp", ".h", ".hpp", ".cs",
        # Ruby / PHP / Swift / Rust
        ".rb", ".php", ".swift", ".rs",
        # Database / SQL
        ".sql",
        # Shell
        ".sh", ".bat", ".ps1"
    }

    for root, dirs, files in os.walk(repo_path):
        # We need to filter directories in-place to prevent walking ignored folders
        rel_root = os.path.relpath(root, repo_path)
        
        # Filter directories
        filtered_dirs = []
        for d in dirs:
            dir_rel_path = d + "/" if rel_root == "." else os.path.join(rel_root, d) + "/"
            # Normalize path for pathspec (uses forward slashes)
            dir_rel_path = dir_rel_path.replace("\\", "/")
            if not gitignore_spec.match_file(dir_rel_path):
                filtered_dirs.append(d)
        dirs[:] = filtered_dirs  # Modifies dirs in-place for os.walk

        # Filter files
        for f in files:
            file_rel_path = f if rel_root == "." else os.path.join(rel_root, f)
            # Normalize path
            file_rel_path_norm = file_rel_path.replace("\\", "/")
            
            # Check gitignore
            if gitignore_spec.match_file(file_rel_path_norm):
                continue
                
            _, ext = os.path.splitext(f)
            if ext.lower() in valid_extensions:
                # Skip files larger than 250KB to protect against minified bundles, dataset dumps, or lockfiles
                try:
                    if os.path.getsize(os.path.join(root, f)) > 250 * 1024:
                        continue
                except Exception:
                    pass
                file_list.append(file_rel_path_norm)
                
                # Add to tree
                parts = file_rel_path_norm.split("/")
                current_node = tree
                for part in parts[:-1]:
                    if part not in current_node["children"]:
                        current_node["children"][part] = {"name": part, "type": "directory", "children": {}}
                    current_node = current_node["children"][part]
                
                current_node["children"][parts[-1]] = {
                    "name": parts[-1],
                    "type": "file",
                    "path": file_rel_path_norm
                }

    # Convert children dictionaries to lists for easy JSON serialization
    def convert_tree_format(node):
        if "children" in node:
            children_list = []
            for child in node["children"].values():
                children_list.append(convert_tree_format(child))
            # Sort: directories first, then files alphabetically
            children_list.sort(key=lambda x: (0 if x["type"] == "directory" else 1, x["name"].lower()))
            node["children"] = children_list
        return node

    formatted_tree = convert_tree_format(tree)
    return file_list, formatted_tree
