from __future__ import annotations

import json
import math
import urllib.error
import urllib.request
import uuid
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import KnowledgeChunk, KnowledgeDocument
from .product_services import lexical_search, split_text_chunks


def embedding_available() -> bool:
    return bool(settings.embedding_base_url and settings.embedding_api_key and settings.embedding_model)


def rerank_available() -> bool:
    return bool(settings.rerank_base_url and settings.rerank_api_key and settings.rerank_model)


def _post_json(url: str, api_key: str, payload: dict[str, Any], timeout: int = 60) -> dict[str, Any]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")[:600]
        raise RuntimeError(f"retrieval_http_{exc.code}:{body}") from exc


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not embedding_available():
        raise RuntimeError("embedding_not_configured")
    if not texts:
        return []
    url = settings.embedding_base_url.rstrip("/") + "/embeddings"
    vectors: list[list[float]] = []
    # Keep requests bounded: imported documents may contain dozens or hundreds of chunks.
    for start in range(0, len(texts), 32):
        batch = texts[start:start + 32]
        body = _post_json(
            url,
            settings.embedding_api_key,
            {"model": settings.embedding_model, "input": batch},
            timeout=90,
        )
        rows = body.get("data") or []
        rows = sorted(rows, key=lambda x: int(x.get("index", 0)))
        batch_vectors = [x.get("embedding") or [] for x in rows]
        if len(batch_vectors) != len(batch) or any(not v for v in batch_vectors):
            raise RuntimeError("embedding_response_invalid")
        vectors.extend(batch_vectors)
    return vectors


def rerank_documents(query: str, documents: list[str]) -> list[dict[str, Any]]:
    if not documents:
        return []
    if not rerank_available():
        return [{"index": i, "relevance_score": 0.0} for i in range(len(documents))]
    url = settings.rerank_base_url.rstrip("/") + "/rerank"
    body = _post_json(
        url,
        settings.rerank_api_key,
        {"model": settings.rerank_model, "query": query, "documents": documents},
        timeout=90,
    )
    rows = body.get("results") or []
    return [
        {"index": int(x.get("index", 0)), "relevance_score": float(x.get("relevance_score", 0.0))}
        for x in rows
        if 0 <= int(x.get("index", -1)) < len(documents)
    ]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if not na or not nb:
        return 0.0
    return dot / (na * nb)


def delete_document_index(db: Session, document_id: str) -> None:
    db.execute(delete(KnowledgeChunk).where(KnowledgeChunk.document_id == document_id))


def index_document(db: Session, row: KnowledgeDocument) -> dict[str, Any]:
    chunks = split_text_chunks(row.raw_text or "")
    delete_document_index(db, row.id)
    vectors: list[list[float]] = []
    engine = "lexical-only"
    if chunks and embedding_available():
        vectors = embed_texts(chunks)
        engine = f"embedding:{settings.embedding_model}"
    for idx, text in enumerate(chunks):
        db.add(
            KnowledgeChunk(
                id=f"kc-{uuid.uuid4().hex[:16]}",
                document_id=row.id,
                user_id=row.user_id,
                chunk_index=idx,
                text=text,
                embedding_json=vectors[idx] if idx < len(vectors) else [],
                embedding_model=settings.embedding_model if vectors else "",
            )
        )
    row.chunk_count = len(chunks)
    meta = dict(row.meta_json or {})
    meta["retrieval_engine"] = engine
    meta["embedding_indexed"] = bool(vectors)
    row.meta_json = meta
    return {"document_id": row.id, "chunks": len(chunks), "engine": engine}


def reindex_all(db: Session, user_id: str) -> dict[str, Any]:
    rows = db.execute(select(KnowledgeDocument).where(KnowledgeDocument.user_id == user_id)).scalars().all()
    indexed = []
    failures = []
    for row in rows:
        try:
            indexed.append(index_document(db, row))
            db.flush()
        except Exception as exc:
            failures.append({"document_id": row.id, "error": str(exc)[:180]})
    db.commit()
    return {"indexed": indexed, "failures": failures, "embedding_configured": embedding_available()}


def hybrid_search(db: Session, user_id: str, query: str, limit: int = 8) -> dict[str, Any]:
    limit = max(1, min(int(limit), 30))
    chunk_rows = db.execute(
        select(KnowledgeChunk).where(KnowledgeChunk.user_id == user_id)
    ).scalars().all()

    # Fallback for databases not indexed yet.
    if not chunk_rows:
        docs = db.execute(select(KnowledgeDocument).where(KnowledgeDocument.user_id == user_id)).scalars().all()
        lexical_docs = [{"id": x.id, "title": x.title, "raw_text": x.raw_text or ""} for x in docs]
        return {"query": query, "results": lexical_search(query, lexical_docs, limit=limit), "engine": "lexical-v1"}

    docs_by_id = {
        x.id: x
        for x in db.execute(select(KnowledgeDocument).where(KnowledgeDocument.user_id == user_id)).scalars().all()
    }
    tokens = [x for x in query.lower().replace("，", " ").replace("。", " ").split() if x]
    candidates: dict[str, dict[str, Any]] = {}

    # Lexical chunk scoring.
    for c in chunk_rows:
        hay = c.text.lower()
        lex = sum(hay.count(t) for t in tokens) if tokens else (1 if query.lower() in hay else 0)
        if lex:
            candidates[c.id] = {"chunk": c, "lexical_score": float(lex), "vector_score": 0.0}

    # Vector recall.
    vector_used = False
    if embedding_available() and any(c.embedding_json for c in chunk_rows):
        try:
            qv = embed_texts([query])[0]
            scored = sorted(
                ((cosine_similarity(qv, c.embedding_json or []), c) for c in chunk_rows),
                key=lambda x: x[0],
                reverse=True,
            )[: max(limit * 4, 20)]
            for score, c in scored:
                item = candidates.setdefault(c.id, {"chunk": c, "lexical_score": 0.0, "vector_score": 0.0})
                item["vector_score"] = float(score)
            vector_used = True
        except Exception:
            vector_used = False

    pool = list(candidates.values())
    if not pool:
        pool = [{"chunk": c, "lexical_score": 0.0, "vector_score": 0.0} for c in chunk_rows[: max(limit * 3, 12)]]
    pool.sort(key=lambda x: (x["vector_score"] * 0.75 + min(x["lexical_score"], 4) * 0.25), reverse=True)
    pool = pool[: max(limit * 4, 20)]

    rerank_used = False
    rerank_scores: dict[int, float] = {}
    if rerank_available() and pool:
        try:
            ranked = rerank_documents(query, [x["chunk"].text for x in pool])
            rerank_scores = {x["index"]: x["relevance_score"] for x in ranked}
            rerank_used = bool(ranked)
        except Exception:
            rerank_used = False

    results = []
    for idx, item in enumerate(pool):
        c = item["chunk"]
        doc = docs_by_id.get(c.document_id)
        final_score = rerank_scores.get(idx)
        if final_score is None:
            final_score = item["vector_score"] * 0.75 + min(item["lexical_score"], 4) * 0.1
        results.append({
            "document_id": c.document_id,
            "source_id": f"kb:{c.document_id}",
            "chunk_id": c.id,
            "chunk_index": c.chunk_index,
            "title": doc.title if doc else c.document_id,
            "text": c.text,
            "score": round(float(final_score), 6),
            "vector_score": round(float(item["vector_score"]), 6),
            "lexical_score": round(float(item["lexical_score"]), 4),
        })
    results.sort(key=lambda x: x["score"], reverse=True)
    return {
        "query": query,
        "results": results[:limit],
        "engine": "+".join([
            "lexical",
            "embedding" if vector_used else "no-vector",
            "reranker" if rerank_used else "no-rerank",
        ]),
        "embedding_model": settings.embedding_model if vector_used else None,
        "rerank_model": settings.rerank_model if rerank_used else None,
    }
