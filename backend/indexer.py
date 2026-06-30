import os
import time
import warnings
import chromadb
import openai
import google.generativeai as genai
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any
from dotenv import load_dotenv

warnings.filterwarnings("ignore", category=FutureWarning)
load_dotenv()

COLLECTION_OPENAI  = "repo_chunks_openai"
COLLECTION_GEMINI  = "repo_chunks_gemini"

# ── Retry helper ─────────────────────────────────────────────────────────────
def _retry(func, *args, **kwargs):
    """Exponential-backoff retry for rate-limit / transient errors."""
    delay = 1.0
    for attempt in range(7):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            msg = str(e).lower()
            transient = any(t in msg for t in ["rate", "quota", "limit", "429", "503", "overloaded", "exhausted"])
            if transient and attempt < 6:
                time.sleep(delay)
                delay = min(delay * 2.0, 60.0)
            else:
                raise


class CodeIndexer:
    def __init__(self, db_path: str = "./chroma_db"):
        self.db_path = os.path.abspath(db_path)
        self.chroma_client = chromadb.PersistentClient(path=self.db_path)

        self.openai_key = os.getenv("OPENAI_API_KEY", "").strip()
        self.gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
        self.grok_key   = os.getenv("GROK_API_KEY",   "").strip()

        # Gemini SDK global config
        if self.gemini_key:
            genai.configure(api_key=self.gemini_key)

        # OpenAI-compatible client (standard OpenAI)
        self.openai_client = openai.OpenAI(api_key=self.openai_key) if self.openai_key else None

        # Grok client — OpenAI SDK pointed at xAI base URL
        self.grok_client = openai.OpenAI(
            api_key=self.grok_key,
            base_url="https://api.x.ai/v1",
        ) if self.grok_key else None

        try:
            provider = self.get_provider()
            print(f"[CodeIndexer] Active embedding provider: {provider.upper()}")
        except ValueError as e:
            print(f"[CodeIndexer] Warning on startup: {str(e)}")

    # ── Provider ──────────────────────────────────────────────────────────────
    def get_provider(self) -> str:
        """Priority: Gemini → Grok → OpenAI → Mock Fallback"""
        if self.gemini_key:
            return "gemini"
        if self.grok_key:
            return "grok"
        if self.openai_key:
            return "openai"
        return "mock"

    def get_collection(self):
        provider = self.get_provider()
        name = COLLECTION_GEMINI if provider == "gemini" else COLLECTION_OPENAI
        return self.chroma_client.get_or_create_collection(
            name=name, metadata={"hnsw:space": "cosine"}
        )

    # ── Embedding helpers ─────────────────────────────────────────────────────
    def _embed_grok_batch(self, texts: List[str]) -> List[List[float]]:
        """Grok embedding via OpenAI-compatible API."""
        resp = _retry(
            self.grok_client.embeddings.create,
            input=texts,
            model="text-embedding-3-small",   # Grok supports this model
        )
        return [d.embedding for d in resp.data]

    def _embed_openai_batch(self, texts: List[str]) -> List[List[float]]:
        resp = _retry(
            self.openai_client.embeddings.create,
            input=texts,
            model="text-embedding-3-small",
        )
        return [d.embedding for d in resp.data]

    def _embed_gemini_batch(self, texts: List[str]) -> List[List[float]]:
        """Single Gemini embeddings call — up to 100 texts."""
        def _call():
            resp = genai.embed_content(
                model="models/gemini-embedding-001",
                content=texts,
                task_type="retrieval_document",
            )
            return resp["embedding"]
        return _retry(_call)

    def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """
        Parallel embedding across sub-batches:
          Grok / OpenAI → 512 texts per batch
          Gemini        → 100 texts per batch
          Mock          → Deterministic MD5 hash generation (offline fallback)
        """
        if not texts:
            return []

        provider = self.get_provider()

        if provider == "mock":
            import hashlib
            import random
            embeddings = []
            for t in texts:
                # Seed randomly but deterministically based on MD5 of text
                h = int(hashlib.md5(t.encode('utf-8')).hexdigest(), 16)
                random.seed(h)
                embeddings.append([random.uniform(-0.1, 0.1) for _ in range(768)])
            return embeddings

        if provider == "grok":
            sub, batch_fn = 512, self._embed_grok_batch
        elif provider == "openai":
            sub, batch_fn = 512, self._embed_openai_batch
        else:
            sub, batch_fn = 100, self._embed_gemini_batch

        batches = [texts[i: i + sub] for i in range(0, len(texts), sub)]
        results: Dict[int, List] = {}

        with ThreadPoolExecutor(max_workers=min(len(batches), 8)) as pool:
            futures = {pool.submit(batch_fn, b): i for i, b in enumerate(batches)}
            for fut in as_completed(futures):
                results[futures[fut]] = fut.result()

        merged: List[List[float]] = []
        for i in range(len(batches)):
            merged.extend(results[i])
        return merged

    # ── Chunking ──────────────────────────────────────────────────────────────
    def chunk_file(self, file_path: str, repo_root: str, file_analysis: Dict[str, Any]) -> List[Dict[str, Any]]:
        abs_path = os.path.join(repo_root, file_path)
        try:
            with open(abs_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except Exception:
            return []

        lines = content.splitlines()
        total = len(lines)
        if total == 0:
            return []

        chunks: List[Dict] = []

        # Semantic boundaries (classes + top-level functions)
        boundaries = []
        for c in file_analysis.get("classes", []):
            boundaries.append((c["start_line"], c["end_line"], "class", c["name"]))
        for fn in file_analysis.get("functions", []):
            in_class = any(
                c["start_line"] <= fn["start_line"] <= c["end_line"]
                for c in file_analysis.get("classes", [])
            )
            if not in_class:
                boundaries.append((fn["start_line"], fn["end_line"], "function", fn["name"]))

        boundaries.sort(key=lambda x: x[0])
        covered: set = set()

        for start, end, ctype, name in boundaries:
            s, e = max(0, start - 1), min(total, end)
            text = "\n".join(lines[s:e])
            if len(text.strip()) > 30:
                chunks.append({
                    "text": f"File: {file_path}\nType: {ctype} ({name})\nLines: {start}-{end}\nCode:\n{text}",
                    "file_path": file_path, "chunk_type": ctype,
                    "name": name, "start_line": start, "end_line": end,
                })
                covered.update(range(s, e))

        # Sliding window for uncovered lines
        window, overlap, i = 50, 10, 0
        while i < total:
            if i in covered:
                i += 1; continue
            block, sl = [], i + 1
            while i < total and i not in covered and len(block) < window:
                block.append(lines[i]); i += 1
            if block:
                text = "\n".join(block)
                if len(text.strip()) > 30:
                    chunks.append({
                        "text": f"File: {file_path}\nType: general\nLines: {sl}-{i}\nCode:\n{text}",
                        "file_path": file_path, "chunk_type": "general",
                        "name": "", "start_line": sl, "end_line": i,
                    })
                if i < total and i not in covered:
                    i = max(i - overlap, sl)

        if not chunks:
            chunks.append({
                "text": f"File: {file_path}\nType: file_full\nLines: 1-{total}\nCode:\n{content}",
                "file_path": file_path, "chunk_type": "file_full",
                "name": "", "start_line": 1, "end_line": total,
            })
        return chunks

    # ── Indexing ──────────────────────────────────────────────────────────────
    def index_repository(self, repo_path: str, file_analyses: Dict[str, Dict[str, Any]]) -> int:
        repo_path = os.path.abspath(repo_path)

        # Wipe old collection for instant fresh start
        provider = self.get_provider()
        coll_name = COLLECTION_GEMINI if provider == "gemini" else COLLECTION_OPENAI
        try:
            self.chroma_client.delete_collection(name=coll_name)
        except Exception:
            pass
        collection = self.chroma_client.get_or_create_collection(
            name=coll_name, metadata={"hnsw:space": "cosine"}
        )

        # Step 1: Parallel chunking (16 threads)
        all_chunks: List[Dict] = []
        with ThreadPoolExecutor(max_workers=16) as pool:
            futures = {
                pool.submit(self.chunk_file, rel, repo_path, ana): rel
                for rel, ana in file_analyses.items()
            }
            for fut in as_completed(futures):
                try:
                    all_chunks.extend(fut.result())
                except Exception:
                    pass

        if not all_chunks:
            return 0

        # Step 2: Parallel embedding (all chunks at once, sub-batched internally)
        docs = [c["text"] for c in all_chunks]
        embeddings = self.generate_embeddings(docs)

        # Step 3: Write to ChromaDB in 500-item batches
        total = len(all_chunks)
        for start in range(0, total, 500):
            batch = all_chunks[start: start + 500]
            embs  = embeddings[start: start + 500]
            collection.add(
                ids       = [f"{c['file_path']}_{c['start_line']}_{c['end_line']}" for c in batch],
                documents = [c["text"] for c in batch],
                embeddings= embs,
                metadatas = [{
                    "file_path":  c["file_path"],
                    "chunk_type": c["chunk_type"],
                    "name":       c["name"] or "",
                    "start_line": int(c["start_line"]),
                    "end_line":   int(c["end_line"]),
                } for c in batch],
            )

        return total

    # ── Search ────────────────────────────────────────────────────────────────
    def search_similarity(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        collection = self.get_collection()
        q_emb = self.generate_embeddings([query])[0]
        results = collection.query(query_embeddings=[q_emb], n_results=limit)

        hits = []
        if results and "documents" in results and results["documents"]:
            for doc, meta, dist in zip(
                results["documents"][0],
                results["metadatas"][0],
                results.get("distances", [[0.0] * limit])[0],
            ):
                hits.append({"text": doc, "metadata": meta, "similarity": 1.0 - dist})
        return hits
