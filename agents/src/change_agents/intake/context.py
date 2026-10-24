"""What the Intake Agent knows before it decides: the project summary and two RAG searches.

Retrieval runs as a fixed step of the graph (not as a tool the model may call), because every intake
needs it and it costs no model calls. It runs again after each answer, with the answers in the query.
"""

from typing import TypedDict

from change_agents.db import connect
from change_agents.rag.embeddings import get_embedder
from change_agents.rag.search import search_code, search_knowledge

CODE_HITS = 3
KNOWLEDGE_HITS = 4
SNIPPET_CHARS = 400


class IntakeContext(TypedDict):
    project_summary: str
    routes: list[str]
    client_knowledge: str
    site_search: str


def load_context(site_id: str, query: str) -> IntakeContext:
    summary, routes = _project_summary(site_id)
    # One embedding for both searches: same text, same task type.
    vector = get_embedder().embed_query(query)

    knowledge = search_knowledge(site_id, query, k=KNOWLEDGE_HITS, query_vector=vector)
    code = search_code(site_id, query, k=CODE_HITS, query_vector=vector)
    return {
        "project_summary": summary,
        "routes": routes,
        "client_knowledge": "\n\n".join(
            f"Source: {hit.source_title} › {hit.heading}\n{hit.content}" for hit in knowledge
        )
        or "(nothing found)",
        "site_search": "\n\n".join(
            f"{hit.file_path}: {hit.context}\n{hit.content[:SNIPPET_CHARS]}".rstrip() for hit in code
        )
        or "(nothing found)",
    }


def _project_summary(site_id: str) -> tuple[str, list[str]]:
    with connect() as connection:
        row = connection.execute(
            "SELECT markdown, summary FROM project_summaries WHERE site_id = %s ORDER BY created_at DESC LIMIT 1",
            (site_id,),
        ).fetchone()
    if row is None:
        return "(no project summary yet)", []
    markdown, summary = row
    return markdown, [page["route"] for page in summary.get("pages", [])]
