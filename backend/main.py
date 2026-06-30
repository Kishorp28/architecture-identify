import os
import json
import shutil
import stat
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

from utils import scan_repository, clone_git_repo
from parser import analyze_file
from indexer import CodeIndexer
from rag import CodeRAG
from refactor import get_static_smells, get_llm_refactoring_advice
from doc_gen import generate_system_docs

def force_delete_dir(path: str):
    if not os.path.exists(path):
        return
    for root, dirs, files in os.walk(path, topdown=False):
        for name in files:
            filepath = os.path.join(root, name)
            try:
                os.chmod(filepath, stat.S_IWRITE)
                os.unlink(filepath)
            except Exception:
                pass
        for name in dirs:
            dirpath = os.path.join(root, name)
            try:
                os.chmod(dirpath, stat.S_IWRITE)
                os.rmdir(dirpath)
            except Exception:
                pass
    try:
        os.chmod(path, stat.S_IWRITE)
        os.rmdir(path)
    except Exception:
        pass


app = FastAPI(title="AI Software Architecture Assistant API")

# Add CORS Middleware to enable communication with the React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict to frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATE_FILE = "./repo_state.json"
state = {
    "status": "idle",
    "error_message": "",
    "repo_path": "",
    "repo_name": "",
    "is_temp": False,
    "file_list": [],
    "folder_tree": {},
    "file_analyses": {},
    # Progress tracking (not persisted to disk)
    "progress_step": "",
    "progress_pct": 0,
}

def load_persisted_state():
    global state
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                state.update(json.load(f))
                # If it was left as indexing during crash, reset to idle
                if state["status"] == "indexing":
                    state["status"] = "idle"
        except Exception:
            pass

def save_persisted_state():
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except Exception:
        pass

load_persisted_state()

# Initialize indexing and RAG objects
indexer = CodeIndexer()
rag = CodeRAG(indexer)

class IndexRequest(BaseModel):
    path_or_url: str = Field(..., description="Local path or git URL of repository")

class ChatRequest(BaseModel):
    question: str = Field(..., description="User query about the repository")

def background_indexing_task(path_or_url: str):
    global state
    state["status"] = "indexing"
    state["error_message"] = ""
    save_persisted_state()
    
    cloned_path = None
    is_temp = False
    
    try:
        # Determine if Git URL or Local Path
        if path_or_url.startswith("http://") or path_or_url.startswith("https://") or path_or_url.endswith(".git"):
            state["repo_name"] = path_or_url.split("/")[-1].replace(".git", "")
            cloned_path = clone_git_repo(path_or_url)
            repo_path = cloned_path
            is_temp = True
        else:
            if not os.path.exists(path_or_url):
                raise FileNotFoundError(f"Local path does not exist: {path_or_url}")
            repo_path = os.path.abspath(path_or_url)
            state["repo_name"] = os.path.basename(repo_path) or "local_repo"
            is_temp = False
            
        state["repo_path"] = repo_path
        state["is_temp"] = is_temp
        save_persisted_state()
        
        # 1. Scan directory structure and files
        state["progress_step"] = "Scanning file tree..."
        state["progress_pct"] = 5
        file_list, folder_tree = scan_repository(repo_path)
        total_files = len(file_list)

        # 2. Analyze code files in parallel (16 workers)
        state["progress_step"] = f"Parsing {total_files} files..."
        state["progress_pct"] = 10
        file_analyses: Dict[str, Any] = {}
        parsed_count = 0

        with ThreadPoolExecutor(max_workers=16) as pool:
            future_to_path = {
                pool.submit(analyze_file, rel, repo_path): rel
                for rel in file_list
            }
            for fut in as_completed(future_to_path):
                rel = future_to_path[fut]
                try:
                    file_analyses[rel] = fut.result()
                except Exception:
                    file_analyses[rel] = {}
                parsed_count += 1
                state["progress_pct"] = 10 + int((parsed_count / max(total_files, 1)) * 40)
                state["progress_step"] = f"Parsed {parsed_count}/{total_files} files"

        # 3. Embed chunks and index in vector store
        state["progress_step"] = "Generating embeddings & indexing..."
        state["progress_pct"] = 55
        indexer.index_repository(repo_path, file_analyses)

        # 4. Save metadata to state
        state["progress_step"] = "Finalising..."
        state["progress_pct"] = 98
        state["file_list"] = file_list
        state["folder_tree"] = folder_tree
        state["file_analyses"] = file_analyses
        state["status"] = "ready"
        state["progress_pct"] = 100
        state["progress_step"] = "Done"
        save_persisted_state()
        
    except Exception as e:
        state["status"] = "error"
        state["error_message"] = str(e)
        save_persisted_state()
        if cloned_path and os.path.exists(cloned_path):
            force_delete_dir(cloned_path)

@app.get("/")
def read_root():
    return {
        "message": "Antigravity AI Architecture Assistant API is running.",
        "frontend_url": "http://localhost:5173",
        "docs_url": "/docs"
    }

@app.post("/api/index")
def index_repository(request: IndexRequest, background_tasks: BackgroundTasks):
    if state["status"] == "indexing":
        raise HTTPException(status_code=400, detail="An index process is already in progress.")
        
    # Start indexing in a background task
    background_tasks.add_task(background_indexing_task, request.path_or_url)
    return {"message": "Indexing started in the background", "status": "indexing"}

@app.get("/api/status")
def get_status():
    return {
        "status": state["status"],
        "repo_name": state["repo_name"],
        "repo_path": state["repo_path"],
        "file_count": len(state["file_list"]),
        "error_message": state["error_message"]
    }

@app.get("/api/progress")
def get_progress():
    return {
        "step": state.get("progress_step", ""),
        "pct": state.get("progress_pct", 0),
    }

@app.get("/api/architecture")
def get_architecture_data():
    if state["status"] != "ready":
        raise HTTPException(status_code=400, detail="Repository not indexed or not ready.")
        
    # Calculate language percentages
    lang_counts = {}
    for f_path in state["file_list"]:
        analysis = state["file_analyses"].get(f_path, {})
        lang = analysis.get("language", "Unknown")
        lang_counts[lang] = lang_counts.get(lang, 0) + 1
        
    total_files = len(state["file_list"])
    lang_percentages = [
        {"language": lang, "count": count, "percentage": round((count / total_files) * 100, 1)}
        for lang, count in lang_counts.items()
    ]
    lang_percentages.sort(key=lambda x: x["count"], reverse=True)
    
    # Gather APIs
    apis = []
    for f_path, analysis in state["file_analyses"].items():
        apis.extend(analysis.get("api_routes", []))
        
    # Gather DB Models
    db_models = []
    for f_path, analysis in state["file_analyses"].items():
        db_models.extend(analysis.get("db_models", []))
        
    # Build module imports list for dependency visualization
    dependencies = []
    for f_path, analysis in state["file_analyses"].items():
        # Clean external imports or standard imports
        for imp in analysis.get("imports", []):
            dependencies.append({
                "from": f_path,
                "import": imp
            })
            
    return {
        "repo_name": state["repo_name"],
        "folder_tree": state["folder_tree"],
        "languages": lang_percentages,
        "api_endpoints": apis,
        "db_models": db_models,
        "imports": dependencies
    }

@app.post("/api/chat")
def query_rag(request: ChatRequest):
    if state["status"] != "ready":
        raise HTTPException(status_code=400, detail="Repository must be indexed first.")
    return rag.query(request.question)

@app.get("/api/refactor/smells")
def get_code_smells():
    if state["status"] != "ready":
        raise HTTPException(status_code=400, detail="Repository must be indexed first.")
    return get_static_smells(state["file_analyses"])

@app.get("/api/refactor/advice")
def get_refactor_advice(file_path: str):
    if state["status"] != "ready":
        raise HTTPException(status_code=400, detail="Repository must be indexed first.")
    if file_path not in state["file_list"]:
        raise HTTPException(status_code=404, detail="File not found in the index.")
    return get_llm_refactoring_advice(file_path, state["repo_path"])

@app.post("/api/generate-docs")
def generate_docs():
    if state["status"] != "ready":
        raise HTTPException(status_code=400, detail="Repository must be indexed first.")
    markdown_content = generate_system_docs(state["file_analyses"])
    return {"markdown": markdown_content}

@app.get("/api/file-content")
def get_file_content(file_path: str):
    if state["status"] != "ready":
        raise HTTPException(status_code=400, detail="Repository must be indexed first.")
    if file_path not in state["file_list"]:
        raise HTTPException(status_code=404, detail="File not found in the index.")
        
    abs_path = os.path.join(state["repo_path"], file_path)
    try:
        with open(abs_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        return {"content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {str(e)}")

# Ensure temp directories are cleaned on app shutdown
@app.on_event("shutdown")
def cleanup_temp_directories():
    if state.get("is_temp") and state.get("repo_path") and os.path.exists(state["repo_path"]):
        try:
            force_delete_dir(state["repo_path"])
        except Exception:
            pass
