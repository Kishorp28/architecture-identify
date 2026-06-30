import os
import networkx as nx
import openai
import google.generativeai as genai
from typing import List, Dict, Any, Tuple
from dotenv import load_dotenv

load_dotenv()

REFACTOR_PROMPT = """You are an expert software engineer and code architect.
Analyze the code of the file '{file_path}' below. Identify any:
1. Duplicate code or copy-paste patterns.
2. Long functions or high complexity.
3. Unused variables, lack of error handling, or performance bottlenecks.
4. Maintainability improvements.

Format your response in JSON with the following structure:
{{
  "overall_summary": "High level summary of code quality and issues.",
  "issues": [
    {{
      "type": "performance|maintainability|complexity|bug_risk",
      "severity": "high|medium|low",
      "description": "Details about the issue.",
      "lines": "Line range or specific line numbers",
      "original_code": "The specific code block containing the issue.",
      "suggested_refactor": "The refactored code block that fixes it."
    }}
  ]
}}

Make sure your response contains ONLY the valid JSON block, starting with {{ and ending with }}. Do not wrap in ```json ... ``` blocks or markdown.

Here is the file content:
-------------------------
{content}
-------------------------
"""

def resolve_import_path(import_str: str, current_file: str, all_files: List[str]) -> str or None:
    """
    Attempts to resolve an import string (like 'backend.utils' or '../db') to one of the repository files.
    """
    # Normalize path separator
    current_file_norm = current_file.replace("\\", "/")
    current_dir = os.path.dirname(current_file_norm)
    
    # Standardize import name (e.g. replace dots in python packages, or relative paths)
    import_parts = import_str.split(".")
    
    # 1. Check relative imports (e.g. from ..utils import x)
    # 2. Check absolute imports relative to repo root
    # Build candidate relative paths
    candidates = []
    
    # Python style: backend.utils
    py_path = "/".join(import_parts)
    candidates.append(py_path + ".py")
    candidates.append(py_path + "/__init__.py")
    
    # JS/TS style: ./utils, ../components/Button
    js_import = import_str.replace("\\", "/")
    if js_import.startswith("./") or js_import.startswith("../"):
        # Resolve relative to current dir
        resolved_rel = os.path.normpath(os.path.join(current_dir, js_import)).replace("\\", "/")
        candidates.append(resolved_rel + ".js")
        candidates.append(resolved_rel + ".ts")
        candidates.append(resolved_rel + ".tsx")
        candidates.append(resolved_rel + ".jsx")
        candidates.append(resolved_rel + "/index.js")
        candidates.append(resolved_rel + "/index.ts")
    else:
        # Check standard import name in files
        candidates.append(js_import + ".js")
        candidates.append(js_import + ".ts")
        candidates.append(js_import + ".tsx")
        
    for cand in candidates:
        # Standardize format
        cand_clean = os.path.normpath(cand).replace("\\", "/").lstrip("/")
        for f in all_files:
            if f.endswith(cand_clean) or cand_clean == f:
                return f
                
    return None

def detect_circular_dependencies(file_analyses: Dict[str, Dict[str, Any]]) -> List[List[str]]:
    """
    Builds a module dependency graph and finds all circular dependency cycles.
    """
    G = nx.DiGraph()
    all_files = list(file_analyses.keys())
    
    # Add nodes
    for f in all_files:
        G.add_node(f)
        
    # Add edges based on imports
    for file_path, analysis in file_analyses.items():
        for imp in analysis.get("imports", []):
            resolved = resolve_import_path(imp, file_path, all_files)
            if resolved and resolved != file_path:
                G.add_edge(file_path, resolved)
                
    # Detect simple cycles
    try:
        cycles = list(nx.simple_cycles(G))
        # Format cycle lists for readability
        return cycles
    except Exception:
        return []

def get_static_smells(file_analyses: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """
    Finds potential code smells using simple static rules:
    - Large files: > 500 lines of code.
    - Long functions: > 60 lines.
    - Circular dependencies in the module graph.
    """
    large_files = []
    long_functions = []
    
    for file_path, analysis in file_analyses.items():
        loc = analysis.get("lines_of_code", 0)
        if loc > 500:
            large_files.append({
                "file_path": file_path,
                "lines": loc
            })
            
        for fn in analysis.get("functions", []):
            fn_lines = fn["end_line"] - fn["start_line"] + 1
            if fn_lines > 60:
                long_functions.append({
                    "file_path": file_path,
                    "function_name": fn["name"],
                    "lines": fn_lines,
                    "range": f"{fn['start_line']}-{fn['end_line']}"
                })
                
    circular_deps = detect_circular_dependencies(file_analyses)
    
    return {
        "large_files": large_files,
        "long_functions": long_functions,
        "circular_dependencies": circular_deps
    }

def get_llm_refactoring_advice(file_path: str, repo_root: str) -> Dict[str, Any]:
    """
    Calls OpenAI or Gemini to perform a deep refactoring code smell analysis on a specific file.
    """
    abs_path = os.path.join(repo_root, file_path)
    if not os.path.exists(abs_path):
        return {"error": f"File not found: {file_path}"}
        
    try:
        with open(abs_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
    except Exception as e:
        return {"error": f"Failed to read file: {str(e)}"}
        
    # Check lines of code. If too large, truncate or ask for specific blocks to avoid rate limits
    lines = content.splitlines()
    if len(lines) > 600:
        # Truncate content for analysis
        content = "\n".join(lines[:600]) + "\n\n... [Code truncated for analysis limit] ..."
        
    openai_key = os.getenv("OPENAI_API_KEY")
    gemini_key = os.getenv("GEMINI_API_KEY")
    
    prompt = REFACTOR_PROMPT.format(file_path=file_path, content=content)
    
    # We prefer OpenAI if both are present
    provider = "openai" if openai_key else "gemini" if gemini_key else None
    
    if not provider:
        return {"error": "No API keys configured. Set OPENAI_API_KEY or GEMINI_API_KEY in backend/.env"}
        
    import json
    
    try:
        if provider == "openai":
            client = openai.OpenAI(api_key=openai_key)
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                response_format={"type": "json_object"}
            )
            data = json.loads(response.choices[0].message.content)
            return data
            
        elif provider == "gemini":
            genai.configure(api_key=gemini_key)
            model = genai.GenerativeModel("gemini-2.5-flash")
            response = model.generate_content(
                contents=prompt,
                generation_config={
                    "temperature": 0.1,
                    "response_mime_type": "application/json"
                }
            )
            data = json.loads(response.text)
            return data
            
    except Exception as e:
        return {"error": f"LLM analysis failed: {str(e)}"}
