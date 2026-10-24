"""rag-index: embed a site's code and/or its client knowledge.
rag-search: try a query and see what each search mode finds."""

import argparse

from change_agents.rag.indexing import index_code, index_knowledge
from change_agents.rag.search import search_code, search_knowledge

SITES = ["luna-cafe", "brightsmile-dental", "northside-accounting"]
STRATEGIES = ["contextual", "component", "fixed"]


def index_main() -> None:
    parser = argparse.ArgumentParser(description="Embed site code and client knowledge for RAG.")
    parser.add_argument("site_ids", nargs="*", help="Site ids (default: all demo sites).")
    parser.add_argument("--knowledge", action="store_true", help="Index client knowledge instead of code.")
    parser.add_argument("--strategy", choices=[*STRATEGIES, "all"], default="contextual")
    args = parser.parse_args()

    for site_id in args.site_ids or SITES:
        if args.knowledge:
            print(f"{site_id:22} knowledge   {index_knowledge(site_id)}")
            continue
        for strategy in STRATEGIES if args.strategy == "all" else [args.strategy]:
            print(f"{site_id:22} {strategy:11} {index_code(site_id, strategy)}")


def search_main() -> None:
    parser = argparse.ArgumentParser(description="Search a site's code or its client knowledge.")
    parser.add_argument("site_id")
    parser.add_argument("query")
    parser.add_argument("--knowledge", action="store_true")
    parser.add_argument("--mode", choices=["vector", "text", "hybrid"], default="hybrid")
    parser.add_argument("--strategy", choices=STRATEGIES, default="contextual")
    parser.add_argument("-k", type=int, default=5)
    args = parser.parse_args()

    if args.knowledge:
        for i, hit in enumerate(search_knowledge(args.site_id, args.query, args.k, args.mode), start=1):
            print(f"{i}. {hit.source_title} › {hit.heading}   score {hit.score:.4f} (vector #{hit.vector_rank}, text #{hit.text_rank})")
            print(f"   {hit.content[:160].replace(chr(10), ' ')}…")
        return

    for i, hit in enumerate(search_code(args.site_id, args.query, args.k, args.mode, args.strategy), start=1):
        print(f"{i}. {hit.title}   score {hit.score:.4f} (vector #{hit.vector_rank}, text #{hit.text_rank})")
