"""Usage: index-site <site-id> [--dry-run]

Runs the Project Indexer on one site and prints every step the agent takes.
"""

import argparse
import sys
import time

from langchain_core.messages import AIMessage

from change_agents import repos
from change_agents.config import get_settings
from change_agents.indexer.graph import build_indexer_graph, initial_state
from change_agents.indexer.markdown import to_markdown
from change_agents.indexer.store import save_summary, site_exists, source_ref
from change_agents.llm import chat_model
from change_agents.tools.repo import RepoSandbox, make_read_only_tools


def _describe(call: dict) -> str:
    args = ", ".join(f"{value}" for value in call["args"].values())
    return f"{call['name']}({args})"


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the project summary of one site.")
    parser.add_argument("site_id")
    parser.add_argument("--dry-run", action="store_true", help="Print the summary without saving it.")
    args = parser.parse_args()

    settings = get_settings()
    if not args.dry_run and not site_exists(args.site_id):
        sys.exit(f'Unknown site "{args.site_id}". Seed the database first (api: npm run seed).')

    repo = repos.checkout(args.site_id)
    graph = build_indexer_graph(chat_model(settings.indexer_model), make_read_only_tools(RepoSandbox(repo)))

    print(f"Indexing {args.site_id} with {settings.indexer_model}\n")
    started = time.monotonic()
    final: dict = {}
    try:
        _run(graph, args.site_id, final)
    except Exception as error:  # provider errors (quota, billing, bad key) are long; show the useful part
        sys.exit(f"\nThe indexer stopped: {type(error).__name__}: {error}")

    summary = final["summary"]
    stats = {**final["usage"], "turns": final["turns"], "duration_seconds": round(time.monotonic() - started, 1)}
    print(f"\nStats: {stats}\n")
    print(to_markdown(summary))

    if not args.dry_run:
        summary_id = save_summary(args.site_id, source_ref(repo), summary, settings.indexer_model, stats)
        print(f"Saved as project_summaries #{summary_id}")


def _run(graph, site_id: str, final: dict) -> None:  # noqa: ANN001
    # stream_mode="updates" yields what each node returned, as soon as it finishes.
    for update in graph.stream(initial_state(site_id), stream_mode="updates"):
        for node, output in update.items():
            final.update(output)
            if node == "explore":
                message: AIMessage = output["messages"][-1]
                calls = message.tool_calls
                print(f"[turn {output['turns']}] model asks for: " + (", ".join(map(_describe, calls)) if calls else "nothing, done exploring"))
            elif node == "tools":
                print(f"          tools ran: {len(output['messages'])} result(s) sent back to the model")
            elif node == "summarize":
                print("[summarize] structured summary received and validated")
