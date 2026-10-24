"""Hybrid search in Postgres: vector similarity (pgvector) + full-text search, merged with
Reciprocal Rank Fusion (RRF): score = 1/(60 + vector rank) + 1/(60 + text rank)."""

from dataclasses import dataclass
from typing import Literal

from change_agents.db import connect
from change_agents.rag.embeddings import Embedder, get_embedder
from change_agents.rag.indexing import to_pgvector

Mode = Literal["vector", "text", "hybrid"]
RRF_K = 60
CANDIDATES = 20

# Any of the query's words may match (OR), so "customer opinions" still matches a chunk with only "customer".
_TEXT_QUERY = "replace(plainto_tsquery('english', %(text)s)::text, '&', '|')::tsquery"
_EMPTY_HITS = "SELECT NULL::bigint AS id, NULL::bigint AS rank WHERE false"


@dataclass(frozen=True)
class CodeHit:
    file_path: str
    title: str
    kind: str
    context: str
    content: str
    score: float
    vector_rank: int | None
    text_rank: int | None


@dataclass(frozen=True)
class KnowledgeHit:
    source_type: str
    source_title: str
    heading: str
    content: str
    score: float
    vector_rank: int | None
    text_rank: int | None


def _hybrid_sql(table: str, scope: str, columns: str, mode: Mode) -> str:
    vector_hits = f"""
        SELECT id, row_number() OVER (ORDER BY embedding <=> %(vector)s::vector) AS rank
        FROM {table} WHERE {scope}
        ORDER BY embedding <=> %(vector)s::vector LIMIT {CANDIDATES}"""
    text_hits = f"""
        SELECT id, row_number() OVER (ORDER BY ts_rank_cd(search_vector, q.query) DESC) AS rank
        FROM {table}, (SELECT {_TEXT_QUERY} AS query) AS q
        WHERE {scope} AND search_vector @@ q.query
        ORDER BY ts_rank_cd(search_vector, q.query) DESC LIMIT {CANDIDATES}"""
    return f"""
        WITH vector_hits AS ({vector_hits if mode != "text" else _EMPTY_HITS}),
             text_hits AS ({text_hits if mode != "vector" else _EMPTY_HITS})
        SELECT {columns},
               COALESCE(1.0 / ({RRF_K} + v.rank), 0) + COALESCE(1.0 / ({RRF_K} + t.rank), 0) AS score,
               v.rank, t.rank
        FROM vector_hits v
        FULL OUTER JOIN text_hits t ON t.id = v.id
        JOIN {table} c ON c.id = COALESCE(v.id, t.id)
        ORDER BY score DESC
        LIMIT %(k)s"""


def search_code(
    site_id: str,
    query: str,
    k: int = 5,
    mode: Mode = "hybrid",
    strategy: str = "contextual",
    query_vector: list[float] | None = None,
    embedder: Embedder | None = None,
) -> list[CodeHit]:
    if query_vector is None and mode != "text":
        query_vector = (embedder or get_embedder()).embed_query(query)
    sql = _hybrid_sql(
        "code_chunks",
        "site_id = %(site_id)s AND strategy = %(strategy)s",
        "c.file_path, c.title, c.kind, c.context, c.content",
        mode,
    )
    params = {"site_id": site_id, "strategy": strategy, "text": query, "k": k,
              "vector": to_pgvector(query_vector) if query_vector else None}
    with connect() as connection:
        # Keep scanning the HNSW index until enough rows pass the site filter.
        connection.execute("SET LOCAL hnsw.iterative_scan = relaxed_order")
        return [CodeHit(*row) for row in connection.execute(sql, params)]


def search_knowledge(
    site_id: str,
    query: str,
    k: int = 4,
    mode: Mode = "hybrid",
    query_vector: list[float] | None = None,
    embedder: Embedder | None = None,
) -> list[KnowledgeHit]:
    if query_vector is None and mode != "text":
        query_vector = (embedder or get_embedder()).embed_query(query)
    sql = _hybrid_sql(
        "knowledge_chunks",
        "client_id = (SELECT client_id FROM sites WHERE id = %(site_id)s)",
        "c.source_type, c.source_title, c.heading, c.content",
        mode,
    )
    params = {"site_id": site_id, "text": query, "k": k, "vector": to_pgvector(query_vector) if query_vector else None}
    with connect() as connection:
        connection.execute("SET LOCAL hnsw.iterative_scan = relaxed_order")
        return [KnowledgeHit(*row) for row in connection.execute(sql, params)]
