import os
import re
import ast
from typing import List, Dict, Any, Tuple, Set

# Regex patterns for JavaScript/TypeScript, Go, and SQL parsing
JS_IMPORT_RE = re.compile(r'(?:import\s+.*?from\s+[\'"](.+?)[\'"]|require\(\s*[\'"](.+?)[\'"]\s*\))')
JS_CLASS_RE = re.compile(r'\bclass\s+(\w+)')
JS_FUNC_RE = re.compile(r'\b(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:\([^)]*\)|[^=]+)\s*=>)')
JS_ROUTE_RE = re.compile(r'(?:app|router|route)\.(get|post|put|delete|patch|options|head)\(\s*[\'"]([^\'"]+)[\'"]')

GO_IMPORT_RE = re.compile(r'import\s+\((.*?)\)|import\s+"([^"]+)"', re.DOTALL)
GO_FUNC_RE = re.compile(r'func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(')
GO_STRUCT_RE = re.compile(r'type\s+(\w+)\s+(?:struct|interface)')
GO_ROUTE_RE = re.compile(r'\.(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\(\s*[\'"]([^\'"]+)[\'"]')

SQL_TABLE_RE = re.compile(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(', re.IGNORECASE)
PRISMA_MODEL_RE = re.compile(r'model\s+(\w+)\s*\{', re.IGNORECASE)

class PythonCodeParser(ast.NodeVisitor):
    def __init__(self):
        self.classes = []
        self.functions = []
        self.imports = []
        self.api_routes = []
        self.db_models = []

    def visit_Import(self, node):
        for alias in node.names:
            self.imports.append(alias.name)
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        if node.module:
            self.imports.append(node.module)
        self.generic_visit(node)

    def visit_ClassDef(self, node):
        start_line = node.lineno
        end_line = getattr(node, "end_lineno", start_line)
        self.classes.append({
            "name": node.name,
            "start_line": start_line,
            "end_line": end_line,
            "type": "class"
        })
        
        # Check if SQLAlchemy / Tortoise model
        is_db_model = False
        for base in node.bases:
            if isinstance(base, ast.Name) and base.id in ("Base", "Model"):
                is_db_model = True
            elif isinstance(base, ast.Attribute) and base.attr in ("Base", "Model"):
                is_db_model = True
        
        # Or if class name ends with Model / Table
        if is_db_model or node.name.endswith("Model"):
            # Extract fields (class variables)
            fields = []
            for child in node.body:
                if isinstance(child, ast.Assign):
                    for target in child.targets:
                        if isinstance(target, ast.Name):
                            fields.append(target.id)
                elif isinstance(child, ast.AnnAssign):
                    if isinstance(child.target, ast.Name):
                        fields.append(child.target.id)
            self.db_models.append({
                "name": node.name,
                "fields": fields,
                "line": start_line
            })
            
        self.generic_visit(node)

    def visit_FunctionDef(self, node):
        start_line = node.lineno
        end_line = getattr(node, "end_lineno", start_line)
        
        # Skip nested functions for high-level visualization, but record them
        self.functions.append({
            "name": node.name,
            "start_line": start_line,
            "end_line": end_line,
            "type": "function"
        })
        
        # Extract FastAPI / Flask API endpoints
        for decorator in node.decorator_list:
            route_info = self._parse_decorator(decorator)
            if route_info:
                self.api_routes.append({
                    "method": route_info[0],
                    "path": route_info[1],
                    "line": start_line,
                    "handler": node.name
                })
                
        self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node):
        # Treat async functions just like standard functions
        self.visit_FunctionDef(node)

    def _parse_decorator(self, decorator) -> Tuple[str, str] or None:
        """Helper to extract method and path from FastAPI decorators like @app.get('/path')"""
        # Case 1: @app.get('/path') -> Call node
        if isinstance(decorator, ast.Call):
            func = decorator.func
            # check if it is app.get or router.get
            if isinstance(func, ast.Attribute):
                method = func.attr.upper()
                if method in ("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD", "ROUTE"):
                    # Extract first argument (the path)
                    if decorator.args:
                        path_node = decorator.args[0]
                        if isinstance(path_node, ast.Constant): # Python 3.8+
                            return method, str(path_node.value)
                        elif isinstance(path_node, ast.Str): # Python <3.8
                            return method, path_node.s
        return None

def parse_python_file(content: str) -> Dict[str, Any]:
    try:
        tree = ast.parse(content)
        visitor = PythonCodeParser()
        visitor.visit(tree)
        return {
            "classes": visitor.classes,
            "functions": visitor.functions,
            "imports": visitor.imports,
            "api_routes": visitor.api_routes,
            "db_models": visitor.db_models
        }
    except Exception:
        # Fallback to regex if parsing fails (syntax errors, etc.)
        return parse_js_ts_go_regex(content, ".py")

def parse_js_ts_go_regex(content: str, ext: str) -> Dict[str, Any]:
    """Fallback/General regex parser for JS, TS, Go, and Python files."""
    classes = []
    functions = []
    imports = []
    api_routes = []
    db_models = []
    
    lines = content.splitlines()
    
    # Simple line-by-line scanning with regex
    for i, line in enumerate(lines):
        line_num = i + 1
        
        # JS/TS parsing
        if ext in (".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"):
            # Imports
            for match in JS_IMPORT_RE.finditer(line):
                imp = match.group(1) or match.group(2)
                if imp:
                    imports.append(imp)
            # Classes
            class_match = JS_CLASS_RE.search(line)
            if class_match:
                classes.append({"name": class_match.group(1), "start_line": line_num, "end_line": line_num, "type": "class"})
            # Functions
            func_match = JS_FUNC_RE.search(line)
            if func_match:
                func_name = func_match.group(1) or func_match.group(2)
                if func_name:
                    functions.append({"name": func_name, "start_line": line_num, "end_line": line_num, "type": "function"})
            # Express API Routes
            route_match = JS_ROUTE_RE.search(line)
            if route_match:
                api_routes.append({
                    "method": route_match.group(1).upper(),
                    "path": route_match.group(2),
                    "line": line_num
                })
            # Prisma Models
            prisma_match = PRISMA_MODEL_RE.search(line)
            if prisma_match:
                db_models.append({
                    "name": prisma_match.group(1),
                    "fields": [], # populated later if needed, or left empty
                    "line": line_num
                })
                
        # Go parsing
        elif ext == ".go":
            # Functions
            func_match = GO_FUNC_RE.search(line)
            if func_match:
                functions.append({"name": func_match.group(1), "start_line": line_num, "end_line": line_num, "type": "function"})
            # Structs
            struct_match = GO_STRUCT_RE.search(line)
            if struct_match:
                classes.append({"name": struct_match.group(1), "start_line": line_num, "end_line": line_num, "type": "struct"})
            # Gin routes
            route_match = GO_ROUTE_RE.search(line)
            if route_match:
                api_routes.append({
                    "method": route_match.group(1).upper(),
                    "path": route_match.group(2),
                    "line": line_num
                })
                
    # Multi-line / complex regexes
    if ext == ".go":
        # Multi-line imports match
        for match in GO_IMPORT_RE.finditer(content):
            group1, group2 = match.groups()
            if group1:
                # Inside import (...) block
                for imp_line in group1.splitlines():
                    imp_line = imp_line.strip().strip('"')
                    if imp_line:
                        imports.append(imp_line)
            elif group2:
                imports.append(group2)
                
    # Database Table SQL regex
    if ext == ".sql":
        for i, line in enumerate(lines):
            table_match = SQL_TABLE_RE.search(line)
            if table_match:
                db_models.append({
                    "name": table_match.group(1),
                    "fields": [],
                    "line": i + 1
                })
                
    return {
        "classes": classes,
        "functions": functions,
        "imports": imports,
        "api_routes": api_routes,
        "db_models": db_models
    }

def analyze_file(file_path: str, repo_root: str) -> Dict[str, Any]:
    """Analyzes a file, returns code features and language-specific metadata."""
    abs_path = os.path.join(repo_root, file_path)
    rel_path = file_path.replace("\\", "/")
    
    try:
        with open(abs_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
    except Exception as e:
        return {"error": f"Could not read file: {str(e)}"}
        
    _, ext = os.path.splitext(file_path)
    ext = ext.lower()
    
    # Map extensions to programming languages
    lang_map = {
        ".py": "Python",
        ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
        ".ts": "TypeScript", ".tsx": "TypeScript",
        ".go": "Go",
        ".java": "Java", ".kt": "Kotlin",
        ".c": "C", ".cpp": "C++", ".h": "C/C++ Header", ".hpp": "C/C++ Header", ".cs": "C#",
        ".rs": "Rust",
        ".sql": "SQL",
        ".html": "HTML", ".css": "CSS",
        ".json": "JSON", ".yaml": "YAML", ".yml": "YAML", ".toml": "TOML",
        ".md": "Markdown",
        ".sh": "Shell Script", ".bat": "Batch Script", ".ps1": "PowerShell Script"
    }
    language = lang_map.get(ext, "Unknown")
    
    lines = content.splitlines()
    loc = len(lines)
    size_bytes = len(content.encode("utf-8", errors="ignore"))
    
    if ext == ".py":
        parsed = parse_python_file(content)
    else:
        parsed = parse_js_ts_go_regex(content, ext)
        
    # Inject file info into parsed objects
    for item in parsed["api_routes"]:
        item["file"] = rel_path
    for item in parsed["db_models"]:
        item["file"] = rel_path
        
    return {
        "file_path": rel_path,
        "language": language,
        "lines_of_code": loc,
        "size_bytes": size_bytes,
        "classes": parsed["classes"],
        "functions": parsed["functions"],
        "imports": parsed["imports"],
        "api_routes": parsed["api_routes"],
        "db_models": parsed["db_models"]
    }
