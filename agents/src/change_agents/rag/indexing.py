"""Embeds chunks and stores them. Incremental: only chunks whose content changed are embedded again."""

import hashlib
from collections.abc import Sequence

from change_agents import repos
from change_agents.config import get_settings
from change_agents.db import connect
from change_agents.rag.chunking import CodeChunk, KnowledgeChunk, chunk_code, chunk_markdown
from change_agents.rag.embeddings import Embedder, get_embedder
from change_agents.tools.repo import RepoSandbox

KNOWLEDGE_SOURCES = {"brand-guide.md": "brand_guide", "plan.md": "plan", "past-tickets.md": "past_ticket"}


def to_pgvector(vector: Sequence[float]) -> str:
    """pgvector's text format, e.g. "[0.1,0.2,0.3]"; the SQL casts it with ::vector."""
    return "[" + ",".join(f"{value:.7g}" for value in vector) + "]"


def _fingerprint(model: str, text: str) -> str:
    # Includes the model name, so switching embedding models re-embeds everything.
    return hashlib.sha256(f"{model}\n{text}".encode()).hexdigest()


def index_code(site_id: str, strategy: str = "contextual", embedder: Embedder | None = None) -> dict[str, int]:
    settings = get_settings()
    embedder = embedder or get_embedder()

    with connect() as connection:
        row = connection.execute(
            "SELECT summary FROM project_summaries WHERE site_id = %s ORDER BY created_at DESC LIMIT 1", (site_id,)
        ).fetchone()
        summary = row[0] if row else None
        chunks = chunk_code(RepoSandbox(repos.checkout(site_id)), strategy, summary)

        wanted = {(c.file_path, c.chunk_index): (c, _fingerprint(embedder.model_name, c.embedding_text())) for c in chunks}
        existing = dict(
            ((path, index), digest)
            for path, index, digest in connection.execute(
                "SELECT file_path, chunk_index, content_hash FROM code_chunks WHERE site_id = %s AND strategy = %s",
                (site_id, strategy),
            )
        )

        changed: list[tuple[CodeChunk, str]] = [(c, h) for key, (c, h) in wanted.items() if existing.get(key) != h]
        vectors = embedder.embed_documents([c.embedding_text() for c, _ in changed])
        for (chunk, digest), vector in zip(changed, vectors, strict=True):
            connection.execute(
                """
                INSERT INTO code_chunks (site_id, strategy, file_path, chunk_index, kind, title, context, content,
                                         content_hash, embedding, embedding_model)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::vector, %s)
                ON CONFLICT (site_id, strategy, file_path, chunk_index) DO UPDATE SET
                  kind = EXCLUDED.kind, title = EXCLUDED.title, context = EXCLUDED.context,
                  content = EXCLUDED.content, content_hash = EXCLUDED.content_hash,
                  embedding = EXCLUDED.embedding, embedding_model = EXCLUDED.embedding_model, updated_at = now()
                """,
                (site_id, strategy, chunk.file_path, chunk.chunk_index, chunk.kind, chunk.title, chunk.context,
                 chunk.content, digest, to_pgvector(vector), embedder.model_name),
            )

        stale = existing.keys() - wanted.keys()
        for path, index in stale:
            connection.execute(
                "DELETE FROM code_chunks WHERE site_id = %s AND strategy = %s AND file_path = %s AND chunk_index = %s",
                (site_id, strategy, path, index),
            )

    return {"chunks": len(wanted), "embedded": len(changed), "unchanged": len(wanted) - len(changed), "deleted": len(stale)}


def index_knowledge(site_id: str, embedder: Embedder | None = None) -> dict[str, int]:
    settings = get_settings()
    embedder = embedder or get_embedder()
    folder = settings.knowledge_dir / site_id

    chunks: list[KnowledgeChunk] = []
    for filename, source_type in KNOWLEDGE_SOURCES.items():
        if (folder / filename).is_file():
            chunks += chunk_markdown(f"{site_id}/{filename}", source_type, (folder / filename).read_text(encoding="utf-8"))

    with connect() as connection:
        row = connection.execute("SELECT client_id FROM sites WHERE id = %s", (site_id,)).fetchone()
        if row is None:
            raise ValueError(f'Unknown site "{site_id}".')
        client_id = row[0]

        wanted = {(c.source_path, c.chunk_index): (c, _fingerprint(embedder.model_name, c.embedding_text())) for c in chunks}
        existing = dict(
            ((path, index), digest)
            for path, index, digest in connection.execute(
                "SELECT source_path, chunk_index, content_hash FROM knowledge_chunks WHERE client_id = %s AND source_path LIKE %s",
                (client_id, f"{site_id}/%"),
            )
        )

        changed = [(c, h) for key, (c, h) in wanted.items() if existing.get(key) != h]
        vectors = embedder.embed_documents([c.embedding_text() for c, _ in changed])
        for (chunk, digest), vector in zip(changed, vectors, strict=True):
            connection.execute(
                """
                INSERT INTO knowledge_chunks (client_id, source_type, source_title, source_path, chunk_index, heading,
                                              content, content_hash, embedding, embedding_model)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::vector, %s)
                ON CONFLICT (client_id, source_path, chunk_index) DO UPDATE SET
                  source_type = EXCLUDED.source_type, source_title = EXCLUDED.source_title, heading = EXCLUDED.heading,
                  content = EXCLUDED.content, content_hash = EXCLUDED.content_hash,
                  embedding = EXCLUDED.embedding, embedding_model = EXCLUDED.embedding_model, updated_at = now()
                """,
                (client_id, chunk.source_type, chunk.source_title, chunk.source_path, chunk.chunk_index, chunk.heading,
                 chunk.content, digest, to_pgvector(vector), embedder.model_name),
            )

        stale = existing.keys() - wanted.keys()
        for path, index in stale:
            connection.execute(
                "DELETE FROM knowledge_chunks WHERE client_id = %s AND source_path = %s AND chunk_index = %s",
                (client_id, path, index),
            )

    return {"chunks": len(wanted), "embedded": len(changed), "unchanged": len(wanted) - len(changed), "deleted": len(stale)}
