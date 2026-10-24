"""RAG tools for agents, bound to one site (and its client). Used by the Intake and Coder agents."""

from langchain_core.tools import BaseTool, tool

from change_agents.rag.search import search_code, search_knowledge

SNIPPET_CHARS = 600


def make_rag_tools(site_id: str) -> list[BaseTool]:
    @tool
    def search_site(query: str) -> str:
        """Find where something is in this website's code by describing it in plain words,
        e.g. "the section with customer opinions" or "618 123 4567". Returns the best matching files
        with a short excerpt; read the whole file with read_file before changing it."""
        hits = search_code(site_id, query, k=5)
        if not hits:
            return "No matches."
        return "\n\n".join(
            f"{i}. {hit.file_path} [{hit.kind}]\n   {hit.context}\n   {hit.content[:SNIPPET_CHARS]}".rstrip()
            for i, hit in enumerate(hits, start=1)
        )

    @tool
    def search_client_knowledge(query: str) -> str:
        """Search what the agency knows about this client: brand guide (colors, tone, rules),
        contracted plan (what is included or not) and past tickets. Each result names its source;
        cite it when you use it."""
        hits = search_knowledge(site_id, query, k=4)
        if not hits:
            return "No matches."
        return "\n\n".join(
            f"[{i}] Source: {hit.source_title} › {hit.heading}\n{hit.content}" for i, hit in enumerate(hits, start=1)
        )

    return [search_site, search_client_knowledge]
