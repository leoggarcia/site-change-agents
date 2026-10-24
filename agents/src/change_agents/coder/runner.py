"""Runs the Coder Agent on one ticket: fresh workspace, install, graph, result."""

import time
from collections.abc import Callable
from typing import Any

from langchain_core.language_models import BaseChatModel

from change_agents.coder.graph import build_coder_graph, initial_state
from change_agents.coder.tools import Editor, make_coder_tools
from change_agents.coder.workspace import Workspace
from change_agents.rag.search import search_code
from change_agents.rag.tools import make_rag_tools
from change_agents.tools.repo import RepoSandbox, SandboxError

LOCATED_FILES = 3

OnUpdate = Callable[[str, dict[str, Any]], None]


def branch_name(ticket_id: int | str) -> str:
    return f"agent/ticket-{ticket_id}"


def make_locator(site_id: str, sandbox: RepoSandbox) -> Callable[[dict[str, Any]], str]:
    def locate(ticket: dict[str, Any]) -> str:
        target = ticket.get("target") or {}
        query = " ".join(filter(None, [ticket["summary"], ticket.get("details"), target.get("section")]))
        paths: list[str] = []
        for hit in search_code(site_id, query, k=6):
            if hit.file_path not in paths:
                paths.append(hit.file_path)
        blocks = []
        for path in paths[:LOCATED_FILES]:
            try:
                blocks.append(f'<file path="{path}">\n{sandbox.read_file(path)}\n</file>')
            except SandboxError:
                continue
        listing = "\n".join(sandbox.iter_files())
        return f"<file_list>\n{listing}\n</file_list>\n\n<relevant_files>\n" + "\n\n".join(blocks) + "\n</relevant_files>"

    return locate


def run_coder(ticket: dict[str, Any], model: BaseChatModel, on_update: OnUpdate | None = None) -> dict[str, Any]:
    """`ticket` has id, site_id, summary, details, change_type, target and acceptance_criteria."""
    started = time.monotonic()
    site_id = ticket["site_id"]
    branch = branch_name(ticket["id"])
    workspace = Workspace.create(site_id, f"{site_id}-ticket-{ticket['id']}", branch)
    workspace.install()
    if on_update:
        on_update("workspace", {"path": str(workspace.root), "branch": branch})

    sandbox = RepoSandbox(workspace.root)
    editor = Editor(sandbox)
    graph = build_coder_graph(
        model, make_coder_tools(editor, make_rag_tools(site_id)), editor, workspace, make_locator(site_id, sandbox)
    )

    final: dict[str, Any] = {}
    # Each edit-loop turn is two graph steps (edit + tools); leave room for the turn limit to apply first.
    for update in graph.stream(initial_state(ticket), {"recursion_limit": 60}, stream_mode="updates"):
        for node, output in update.items():
            final.update(output or {})
            if on_update:
                on_update(node, output or {})

    return {
        **final["outcome"],
        "branch": branch,
        "usage": final.get("usage", {}),
        "seconds": round(time.monotonic() - started, 1),
    }
