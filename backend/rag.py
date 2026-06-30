import os
import openai
import google.generativeai as genai
from indexer import CodeIndexer
from typing import List, Dict, Any
from dotenv import load_dotenv

load_dotenv()

SYSTEM_PROMPT = """You are Antigravity, a professional AI Software Architecture Assistant. 
Your task is to answer the user's questions about their codebase using the retrieved code context below.

Rules to follow:
1. Base your answer strictly on the provided code snippets and analysis.
2. Explain the system mechanics clearly, citing specific files, classes, methods, or API endpoints.
3. Show relevant code references. When citing, mention the file name and line range clearly, e.g., `utils.py:L10-L45`.
4. If the code context does not contain enough information to answer the question, state that clearly, but try to offer general architectural guidance based on what you *can* see.
5. Format your response in clean Markdown.

Retrieved Code Context:
----------------------
{context}
----------------------
"""

class CodeRAG:
    def __init__(self, indexer: CodeIndexer):
        self.indexer   = indexer
        self.openai_key = os.getenv("OPENAI_API_KEY", "").strip()
        self.gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
        self.grok_key   = os.getenv("GROK_API_KEY",   "").strip()

        if self.gemini_key:
            genai.configure(api_key=self.gemini_key)

        self.openai_client = openai.OpenAI(api_key=self.openai_key) if self.openai_key else None

        # Grok uses the OpenAI SDK pointed at xAI's base URL
        self.grok_client = openai.OpenAI(
            api_key=self.grok_key,
            base_url="https://api.x.ai/v1",
        ) if self.grok_key else None

    def query(self, user_question: str, top_k: int = 8) -> Dict[str, Any]:
        # 1. Retrieve relevant chunks
        try:
            hits = self.indexer.search_similarity(user_question, limit=top_k)
        except Exception as e:
            return {"answer": f"Error searching vector store: {str(e)}", "sources": []}

        if not hits:
            return {
                "answer": "No matching code blocks found. Please index a repository first.",
                "sources": []
            }

        # 2. Build context + sources
        context_blocks, sources, seen = [], [], set()
        for hit in hits:
            context_blocks.append(hit["text"])
            meta = hit["metadata"]
            sid  = f"{meta['file_path']}:{meta['start_line']}-{meta['end_line']}"
            if sid not in seen:
                seen.add(sid)
                sources.append({
                    "file_path":  meta["file_path"],
                    "chunk_type": meta["chunk_type"],
                    "name":       meta.get("name", ""),
                    "start_line": int(meta["start_line"]),
                    "end_line":   int(meta["end_line"]),
                    "similarity": float(hit["similarity"]),
                })

        context_str       = "\n\n=======================\n\n".join(context_blocks)
        full_system_prompt = SYSTEM_PROMPT.format(context=context_str)

        # 3. Generate answer — provider priority: Grok → Gemini → OpenAI
        provider = self.indexer.get_provider()
        answer   = ""

        try:
            if provider == "mock":
                # Deterministic mock RAG response
                answer = "### 🔴 Offline Mock Mode (No Active API Keys)\n\n"
                answer += f"I received your question: *\"{user_question}\"*\n\n"
                answer += "Here are the code fragments I matched in the vector database:\n\n"
                for idx, s in enumerate(sources):
                    answer += f"{idx+1}. **{s['file_path']}** (lines {s['start_line']}-{s['end_line']})\n"
                answer += "\nTo enable real AI answers, configure a valid **`GROK_API_KEY`**, **`GEMINI_API_KEY`**, or **`OPENAI_API_KEY`** in your `backend/.env` file."

            elif provider == "grok":
                response = self.grok_client.chat.completions.create(
                    model="grok-3",
                    messages=[
                        {"role": "system", "content": full_system_prompt},
                        {"role": "user",   "content": user_question},
                    ],
                    temperature=0.2,
                )
                answer = response.choices[0].message.content

            elif provider == "gemini":
                model    = genai.GenerativeModel("gemini-2.5-flash")
                response = model.generate_content(
                    contents=f"{full_system_prompt}\n\nUser Question: {user_question}",
                    generation_config={"temperature": 0.2},
                )
                answer = response.text

            elif provider == "openai":
                response = self.openai_client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": full_system_prompt},
                        {"role": "user",   "content": user_question},
                    ],
                    temperature=0.2,
                )
                answer = response.choices[0].message.content

        except Exception as e:
            answer = f"LLM error ({provider}): {str(e)}"

        return {"answer": answer, "sources": sources}
