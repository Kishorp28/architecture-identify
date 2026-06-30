import os
import openai
import google.generativeai as genai
from typing import List, Dict, Any
from dotenv import load_dotenv

load_dotenv()

DOCS_PROMPT = """You are a senior software architect. 
Generate a comprehensive, professional **Software Architecture Guide** for the codebase described below.

Use the provided metadata, detected files, APIs, and database models to structure your document.
Your generated guide MUST contain the following sections:

# Codebase Architecture Guide & Technical Docs

## 1. Executive Summary & Tech Stack
- Summarize what this project does based on the file names, directory layout, and languages.
- Detail the languages, frameworks, and database technologies detected (e.g. FastAPI, Express, SQLAlchemy, etc.).

## 2. Directory Structure & Key Components
- Walk through the folder layout, highlighting the roles of primary folders and modules.
- Explain the division of responsibilities (e.g., frontend, backend, routes, database, models).

## 3. API Registry & Endpoint Documentation
- Present the list of detected API endpoints in a clean Markdown table:
  | Method | Path | Source File | Handler Function | Description (Inferred) |
  *(Populate the table using the detected routes list, inferring what each does).*

## 4. Database Schema & Data Models
- List the detected database tables or models.
- Present their fields and describe how the schema is structured.

## 5. Architectural Recommendations & Best Practices
- Provide constructive design feedback based on the file structure (e.g. modularization suggestions, design patterns to use).

Metadata:
---------
Detected Languages: {languages}
Project File Count: {file_count}
API Routes: {routes_meta}
Database Models: {db_meta}
---------

Write a rich, detailed, publication-quality document in Markdown. Do not include any HTML, start directly with the markdown content.
"""

def generate_system_docs(file_analyses: Dict[str, Dict[str, Any]]) -> str:
    """
    Summarizes all codebase structures and uses LLM to generate a full Architecture Documentation page.
    """
    # Extract metadata for prompt
    languages = set()
    routes_meta = []
    db_meta = []
    file_count = len(file_analyses)
    
    for path, analysis in file_analyses.items():
        if analysis.get("language") and analysis["language"] != "Unknown":
            languages.add(analysis["language"])
            
        for route in analysis.get("api_routes", []):
            routes_meta.append({
                "method": route.get("method"),
                "path": route.get("path"),
                "file": path,
                "handler": route.get("handler", "N/A")
            })
            
        for model in analysis.get("db_models", []):
            db_meta.append({
                "name": model.get("name"),
                "fields": model.get("fields", []),
                "file": path
            })
            
    languages_str = ", ".join(list(languages)) if languages else "Unknown"
    
    openai_key = os.getenv("OPENAI_API_KEY")
    gemini_key = os.getenv("GEMINI_API_KEY")
    
    # We prefer OpenAI if both are present
    provider = "openai" if openai_key else "gemini" if gemini_key else None
    
    if not provider:
        return """# Codebase Architecture Guide

## Error: API Keys Missing
Please set `OPENAI_API_KEY` or `GEMINI_API_KEY` in `backend/.env` to enable AI documentation generation.

---

### Basic Scanned Summary
- **Languages Detected**: {langs}
- **Indexed Files**: {count}
- **API Endpoints Extracted**: {apis}
- **Database Schema Models**: {models}
""".format(
            langs=languages_str,
            count=file_count,
            apis=len(routes_meta),
            models=len(db_meta)
        )
        
    prompt = DOCS_PROMPT.format(
        languages=languages_str,
        file_count=file_count,
        routes_meta=str(routes_meta[:60]),  # Limit size to prevent overflow
        db_meta=str(db_meta[:60])
    )
    
    try:
        if provider == "openai":
            client = openai.OpenAI(api_key=openai_key)
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2
            )
            return response.choices[0].message.content
            
        elif provider == "gemini":
            genai.configure(api_key=gemini_key)
            model = genai.GenerativeModel("gemini-2.5-flash")
            response = model.generate_content(
                contents=prompt,
                generation_config={"temperature": 0.2}
            )
            return response.text
            
    except Exception as e:
        return f"# Codebase Architecture Guide\n\nError generating documentation: {str(e)}"
