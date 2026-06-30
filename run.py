import sys
import os
import warnings

# Suppress deprecation warnings from google-generativeai
warnings.filterwarnings("ignore", category=FutureWarning)

# Add backend/ to sys.path so all local imports resolve
BACKEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend")
sys.path.insert(0, BACKEND_DIR)

# Change working directory to backend/ so .env and chroma_db paths resolve correctly
os.chdir(BACKEND_DIR)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True, reload_dirs=[BACKEND_DIR])
