"""Runs the checks and the Reviewer Agent on a ticket's branch."""

import time
from collections.abc import Callable
from typing import Any

from langchain_core.language_models import BaseChatModel

from change_agents.coder.workspace import Workspace
from change_agents.db import connect
from change_agents.rag.search import search_knowledge
from change_agents.reviewer.graph import build_reviewer_graph, initial_state

OnUpdate = Callable[[str, dict[str, Any]], None]


def fetch_knowledge(site_id: str, query: str) -> str:
    hits = search_knowledge(site_id, query, k=4)
    return "\n\n".join(f"Source: {hit.source_title} › {hit.heading}\n{hit.content}" for hit in hits) or "(nothing found)"


def run_reviewer(
    ticket: dict[str, Any], workspace: Workspace, model: BaseChatModel, on_update: OnUpdate | None = None
) -> dict[str, Any]:
    """`ticket` has site_id, summary, details, acceptance_criteria and the client's original request."""
    started = time.monotonic()
    graph = build_reviewer_graph(model, workspace, fetch_knowledge)
    final: dict[str, Any] = {}
    for update in graph.stream(initial_state(ticket), stream_mode="updates"):
        for node, output in update.items():
            final.update(output or {})
            if on_update:
                on_update(node, output or {})
    return {**final["outcome"], "usage": final.get("usage", {}), "seconds": round(time.monotonic() - started, 1)}


def open_ticket_workspace(site_id: str, ticket_id: int | str, branch: str, commit: str) -> Workspace:
    return Workspace.reopen(site_id, f"{site_id}-ticket-{ticket_id}", branch, commit)


def intake_conversation(ticket_id: int) -> list[dict[str, str]]:
    """The questions and answers of the ticket's latest intake run, in order (for the CLI; the API sends them in jobs)."""
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT type, message FROM ticket_events
            WHERE ticket_id = %(id)s AND type IN ('agent_question', 'client_answer')
              AND id > (SELECT max(id) FROM ticket_events WHERE ticket_id = %(id)s AND to_status = 'intake')
            ORDER BY id
            """,
            {"id": ticket_id},
        ).fetchall()
    pairs: list[dict[str, str]] = []
    for kind, message in rows:
        if kind == "agent_question":
            pairs.append({"question": message, "answer": ""})
        elif pairs:
            pairs[-1]["answer"] = message
    return pairs
