"""Usage:
    coder-run --ticket 12                                  # a ticket from the database
    coder-run luna-cafe "Change the phone number" --details "From 618 123 4567 to 618 765 4321"

Runs the Coder Agent in a fresh workspace and prints each step, the result and the diff.
"""

import argparse
import json
import sys
import uuid
from typing import Any

from change_agents.coder.runner import run_coder
from change_agents.coder.workspace import Workspace
from change_agents.config import get_settings
from change_agents.db import connect
from change_agents.llm import chat_model


def _ticket_from_db(ticket_id: int) -> dict[str, Any]:
    with connect() as connection:
        row = connection.execute(
            "SELECT id, site_id, summary, details, change_type, target, acceptance_criteria, request FROM tickets WHERE id = %s",
            (ticket_id,),
        ).fetchone()
    if row is None:
        sys.exit(f"Ticket {ticket_id} not found.")
    id_, site_id, summary, details, change_type, target, criteria, request = row
    return {
        "id": id_,
        "site_id": site_id,
        "summary": summary or request,
        "details": details or request,
        "change_type": change_type,
        "target": target,
        "acceptance_criteria": criteria,
    }


def _print_update(node: str, output: dict[str, Any]) -> None:
    if node == "workspace":
        print(f"[workspace] {output['path']} on branch {output['branch']} (dependencies installed)")
    elif node == "locate":
        print("[locate]    RAG picked the relevant files")
    elif node == "plan":
        if output.get("plan_error"):
            print(f"[plan]      invalid plan, retrying: {output['plan_error']}")
        else:
            plan = output["plan"]
            print(f"[plan]      {plan['understanding']}")
            for step in plan["steps"]:
                print(f"              - {step['action']} {step['file']}: {step['what']}")
    elif node == "edit":
        message = output["messages"][-1]
        calls = ", ".join(f"{c['name']}({c['args'].get('path') or c['args'].get('text') or c['args'].get('query') or ''})" for c in message.tool_calls)
        print(f"[edit {output['turns']:>2}]   " + (f"model asks for: {calls}" if calls else f"model is done: {message.text[:160]}"))
    elif node == "tools":
        for message in output["messages"]:
            if str(message.content).startswith("Error"):
                print(f"            refused/failed: {str(message.content)[:160]}")
    elif node == "check":
        if output.get("stop_reason"):
            print(f"[check]     {output['stop_reason']}")
        else:
            print(f"[check]     build {'passed' if not output.get('build_output') else 'FAILED, sending the error back'}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Coder Agent on one ticket.")
    parser.add_argument("site_id", nargs="?")
    parser.add_argument("summary", nargs="?")
    parser.add_argument("--details", default="")
    parser.add_argument("--ticket", type=int, help="Use a ticket from the database instead.")
    args = parser.parse_args()

    if args.ticket:
        ticket = _ticket_from_db(args.ticket)
    elif args.site_id and args.summary:
        ticket = {"id": f"cli-{uuid.uuid4().hex[:6]}", "site_id": args.site_id, "summary": args.summary, "details": args.details}
    else:
        parser.error("give --ticket ID, or a site id and a summary")

    settings = get_settings()
    print(f"Coding ticket {ticket['id']} on {ticket['site_id']} with {settings.coder_model}\n")
    try:
        result = run_coder(ticket, chat_model(settings.coder_model), on_update=_print_update)
    except Exception as error:  # provider and git errors are long; show the useful part
        sys.exit(f"\nThe coder stopped: {type(error).__name__}: {str(error)[:500]}")

    print(f"\nResult: {json.dumps(result, indent=2, ensure_ascii=False)}")
    if result["status"] == "done":
        workspace = Workspace(settings.workspaces_dir / f"{ticket['site_id']}-ticket-{ticket['id']}", result["branch"])
        print("\n" + workspace.show_last_commit())
