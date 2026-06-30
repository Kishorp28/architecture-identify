import sys
import os

print("Python Version:", sys.version)

try:
    import fastapi
    print("[OK] fastapi imported")
    import uvicorn
    print("[OK] uvicorn imported")
    import chromadb
    print("[OK] chromadb imported")
    import openai
    print("[OK] openai imported")
    import google.generativeai as genai
    print("[OK] google-generativeai imported")
    import git
    print("[OK] gitpython imported")
    import pathspec
    print("[OK] pathspec imported")
    import networkx as nx
    print("[OK] networkx imported")
    
    # Configure sys.path to resolve local imports properly
    current_dir = os.path.dirname(os.path.abspath(__file__))
    if current_dir not in sys.path:
        sys.path.insert(0, current_dir)
        
    # Import local modules
    from utils import scan_repository
    from parser import analyze_file
    from indexer import CodeIndexer
    from rag import CodeRAG
    from refactor import get_static_smells
    from doc_gen import generate_system_docs

    
    print("[OK] All local modules imported successfully!")
    
except Exception as e:
    print("[FAIL] Verification failed with error:")
    print(e)
    sys.exit(1)

print("Verification Succeeded! All modules are operational.")
sys.exit(0)
